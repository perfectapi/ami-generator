var ec2 = require("./ec2proxy.js");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var instanceGen = require(path.join(__dirname, 'instanceGen.js'));
var amiGen = require(path.join(__dirname, 'amiGen.js'));
var logger = require('winston').loggers.get('amigen-console');


exports.getImageUsingConfig = function(config, callback) {
	/*
	example config (perfectapi compatible):
	{   
	"environment" : {
		"AWS_ACCESS_KEY_ID":"abuhgsdjashg",
		"AWS_SECRET_ACCESS_KEY":"ajdshkh234hjkhask"
	};
	"options": {
		"root": "scripts"
	,   "ami": "ami-a562a9cc"
	}
	,   "scripts": ["Node0.4.12", "Node0.4.12/cloud9", "NginxProxy"]
	}
	
	*/
	
	if (config.environment.AWS_ACCESS_KEY_ID=="") {
			callback("AWS_ACCESS_KEY_ID environment variable is required.");
			return;
	};
	if (config.environment.AWS_SECRET_ACCESS_KEY=="") {
			callback("AWS_SECRET_ACCESS_KEY environment variable is required.");
			return;
	};    
    
	var options = config.options;
	var rootPath = path.resolve(options.root);
    
	//take the list of scripts and sort and normalize them.
	var scripts = [];
	var osSep = (process.platform=='win32') ? '\\': '/';
	for(var i=0;i<config.scripts.length;i++) {
		var scriptParts = config.scripts[i].split(osSep);
		
		var currentScript = '';
		for(var j=0;j<scriptParts.length;j++) {
			var sep = (j==0) ? '': osSep;
			currentScript = currentScript + sep + scriptParts[j];
			
			scripts.push(currentScript);
		}
	};
	scripts = scripts.sort(function(A,B) {
		var a=A.toLowerCase(), b=B.toLowerCase();
		if (a < b) return -1;
		if (b < a) return 1;
		return 0;
	});
	var scriptsWithoutDups = [];
	var lastScript = '';
	for(var i=0;i<scripts.length;i++) {
			if (scripts[i] != lastScript) {
					scriptsWithoutDups.push(scripts[i]);
					lastScript = scripts[i];
			};
	}
    
	logger.info('scripts = ' + scriptsWithoutDups);
	
	//validate scripts exist
	for(var i=0;i<scriptsWithoutDups.length;i++) {
		var userData = path.resolve(rootPath, scriptsWithoutDups[i], 'user-data.sh');
		if (!fs.existsSync(userData)) {
			callback('Script ' + scriptsWithoutDups[i] + ' does not exist at ' + rootPath);
			return;
		}
	}
	
	if (!options.ami) {
		//need to lookup an AMI
		var configFilePath = path.resolve(rootPath, scriptsWithoutDups[0], 'config.json');
		if (!fs.existsSync(configFilePath)) return callback('Cannot find config containing AMI ids at ' + configFilePath);
		
		var amiConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
		//logger.verbose(JSON.stringify(amiConfig.Mappings.AWSRegionArch2AMI["us-east-1"]));
		var regionConfig = amiConfig.Mappings.AWSRegionArch2AMI[options.region];
		if (!regionConfig) return callback('Region ' + options.region + ' does not have a base AMI specified.  Please use --ami option to specify an AMI directly');
		var bitNess = (options.bit32) ? "32" : "64";
		var ami = regionConfig[bitNess];
		if (!ami) return callback('Could not find a base AMI for ' + bitNess + 'bit in region ' + config.region + '.  Please use --ami option to specify an AMI directly');
		
		options.ami = ami;
	}

	var baseAMI = options.ami;
	logger.verbose('root = ' + options.root);
	logger.verbose('baseAMI = ' + options.ami);

	var ec2config = {
		"AWS_ACCESS_KEY_ID": config.environment.AWS_ACCESS_KEY_ID,
		"AWS_SECRET_ACCESS_KEY": config.environment.AWS_SECRET_ACCESS_KEY,
		"endpoint": config.options.region};
		
	//now we have a list of scripts that can be executed in order    
	var myScript = scriptsWithoutDups.shift();
	var lineage = 'amigen,' + baseAMI + ',' + myScript;
	getImage(rootPath, myScript, lineage, baseAMI, config, recurse = function(err, newAMI) {
			if (err) {callback(err); return;}
			
			if (scriptsWithoutDups.length > 0) {
					//go to next script
					myScript = scriptsWithoutDups.shift();
					lineage = lineage + ',' + myScript;
					getImage(rootPath, myScript, lineage, newAMI, config, recurse);  //handy recursion trick, *evil laugh*
			} else {
					//all done.
					if (config.options.publish)
						publishAmi(ec2config, newAMI);

					callback(null, newAMI);
			}
	});
};

getImage = function(
	rootPath,     //lowest path with scripts
	script,       //partial path to the script location we want to use
	lineage,	  //lineage of this image
	baseAMI,      //AMI to use as a basis for the new AMI image
	config, 	  //full config provided via API
	callback) {
    
	logger.verbose('getting image from ' + path.join(rootPath, script) + ' using base ' + baseAMI);
	
	getUserDataHash(rootPath, script, baseAMI, function(err, uniqueName, userData64) {
		if (err) return callback(err);
		
		var ec2config = {
			"AWS_ACCESS_KEY_ID": config.environment.AWS_ACCESS_KEY_ID,
			"AWS_SECRET_ACCESS_KEY": config.environment.AWS_SECRET_ACCESS_KEY,
			"endpoint": config.options.region};
		
		logger.verbose('Unique name of image should be ' + uniqueName);
				
		//see if we can find the image...
		ec2.call(ec2config, "DescribeImages", {
			"Filter.1.Name": "tag:uniqueName",
			"Filter.1.Value.1": uniqueName
		}, function(err, response) {
			
			if (err) return callback(err);
			
			if (response.imagesSet 
			&& response.imagesSet.length > 0) {
			
				var imageId = response.imagesSet[0].imageId;
				logger.verbose('found matching image ' + imageId);
				
				ec2.waitForImageState(ec2config, imageId, 'available', 2000, callback);
			} else {
				//does notexist yet
				logger.verbose('no matching image yet - will generate now...could take a while...');
				instanceGen.generateInstance(userData64, baseAMI, uniqueName, config, function(err, instanceId) {
					if (err) return callback(err);

					amiGen.generateAMI(instanceId, uniqueName, lineage, config, function(err, amiId) {
						if (err) return callback(err, amiId);
						
						callback(null, amiId);
					});
				});
			}
		});
	});
};

function publishAmi(ec2config, amiId, callback) {
	ec2.call(ec2config, "ModifyImageAttribute", {
		"ImageId": amiId,
		"LaunchPermission.Add.1.Group": "all"
	}, function(err, response) {
		if (err && callback) return callback(err);
		
		logger.verbose('AMI ' + amiId + ' has been published');
		
		if (callback) callback();
	});
}

function formatWordKey(buf) {
	var key = "";  //buf.toString('hex');
	var letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";  //no I,O,i,l,o because they hard to read
	for(var i=0;i<buf.length;i++) {
	  var letterNumber = buf[i] % (52 - 5);  //subtract unused letters
	  key = key + letters[letterNumber];
	};
	
	return key;
}
    
getUserDataHash = function(rootPath, script, baseAMI, callback) {
    getUserData64(rootPath, script, function(err, userData64) {
        if (err) {
            callback(err, '', userData64);
        } else {
            var hash = crypto.createHash('sha1');
			
            hash.update(userData64);   //in case the scripts change
            hash.update(baseAMI);      //in case we get a new baseAMI.  This also takes care of uniqueness for multiple scripts at same level
            //hash.update(rootPath.replace('\\', '/'));     //part of the script name that was run
            hash.update(script.replace(/\\/g, '/'));       //other part of the script name that was run
			
            var result = formatWordKey(new Buffer(hash.digest()));
			
            callback(null, result, userData64);
        }
    });
};

getUserData64 = function(rootPath, script, callback) {
    getUserData(rootPath, script, function(err, userData) {
        if (err)
            callback(err)
        else
            callback(err, userData.toString('base64'));
    });
};

getAllPathsToRoot = function(rootPath, script) {
    rootPath = path.resolve(rootPath);
    var currentPath = path.resolve(rootPath, script);;

    var allPaths = [];
    while(currentPath != rootPath) {
        allPaths.push(currentPath);
        
        currentPath = path.resolve(currentPath, '..');
    }
    allPaths.push(rootPath);
    
    return allPaths;
};

getPreUserData = function(rootPath, script, callback) {
    var allPaths = getAllPathsToRoot(rootPath, script);

    var newFile = path.join(findTempDirectory(), 'pre.tmp');    
    var ws = fs.createWriteStream(newFile);
    while(allPaths.length > 0) {
        var currentPath = allPaths.shift();  //take from front, which is root
        
        var currentFile = path.resolve(currentPath, 'pre.sh');
        if (fs.existsSync(currentFile)) {
            var b = fs.readFileSync(currentFile, 'utf8');
			b = b.replace(/\r\n/g, '\n');
            ws.write(b);
            ws.write("\n");
        }
    }
    ws.end();
    ws.destroySoon();
    
    ws.on('close', function() {
        var preData = fs.readFileSync(newFile);
        logger.verbose('preData generated, length = ' + preData.length);
    
        callback(null, preData);
    });    
    
    ws.on('error', function(err) {
        callback(err);
    });
};

getPostUserData = function(rootPath, script, callback) {
    var allPaths = getAllPathsToRoot(rootPath, script);

    var newFile = path.join(findTempDirectory(), 'post.tmp');    
    var ws = fs.createWriteStream(newFile);
    while(allPaths.length > 0) {
        var currentPath = allPaths.pop();  //take from end, which is final path
        
        var currentFile = path.resolve(currentPath, 'post.sh');
        if (fs.existsSync(currentFile)) {
            var b = fs.readFileSync(currentFile, 'utf8');
			b = b.replace(/\r\n/g, '\n');
            ws.write(b);
            ws.write("\n");
        }
    }
    ws.end();
    ws.destroySoon();
    
    ws.on('close', function() {
        var postData = fs.readFileSync(newFile);
        logger.verbose('postData generated, length = ' + postData.length);
    
        callback(null, postData);
    });    
    
    ws.on('error', function(err) {
        callback(err);
    });
}

getInstallScript = function(rootPath, script, callback) {
    var allPaths = getAllPathsToRoot(rootPath, script);

    var newFile = path.join(findTempDirectory(), 'install.tmp');    
    var ws = fs.createWriteStream(newFile);
    while(allPaths.length > 0) {
        var currentPath = allPaths.pop();  //take from end, which is final path
        
        var currentFile = path.resolve(currentPath, 'install.sh');
        if (fs.existsSync(currentFile)) {
            var b = fs.readFileSync(currentFile, 'utf8');
			b = b.replace(/\r\n/g, '\n');
            ws.write(b);
            ws.write("\n");
        }
    }
    ws.end();
    ws.destroySoon();
    
    ws.on('close', function() {
        var installData = fs.readFileSync(newFile);
        logger.verbose('install generated, length = ' + installData.length);
    
        callback(null, installData);
    });    
    
    ws.on('error', function(err) {
        callback(err);
    });
}

getUserData = function(rootPath, script, callback) {
    var myPath = path.resolve(rootPath, script);
    
    logger.verbose('path = ' + myPath);
    
    var newFile = path.join(findTempDirectory(), 'user-data.tmp');
    var ws = fs.createWriteStream(newFile);
    getPreUserData(rootPath, script, function(err, data) {
        if (err) { callback(err); return; }
        
        ws.write(data);
        
        var currentFile = path.resolve(myPath, 'user-data.sh');
        if (fs.existsSync(currentFile)) {
            var b = fs.readFileSync(currentFile, 'utf8');
			b = b.replace(/\r\n/g, '\n');
            ws.write(b);
            ws.write("\n");
        }
        
		getInstallScript(rootPath, script, function(err, data) {
			if (err) { callback(err); return; }
			
			//install script needs to be escaped and output to a file
			ws.write('cat > /home/$MY_USER/install.sh <<EOFINSTALL\n');
			ws.write(data.toString('utf8').replace(/\\/g, '\\\\').replace(/\$/g, '\\\$'));   //escape variables (and escapes); we only want to evaluate them when script is run
			ws.write('EOFINSTALL\n');
			ws.write('chown $MY_USER /home/$MY_USER/install.sh \n');
			ws.write('chmod +x /home/$MY_USER/install.sh \n');
			
			getPostUserData(rootPath, script, function(err, data) {
				if (err) { callback(err); return; }
				
				ws.write(data);
				ws.end();
				ws.destroySoon();
			});
		});
    });
    
    ws.on('close', function() {
        var userData = fs.readFileSync(newFile);
        logger.verbose('userdata generated, length = ' + userData.length);
    
        callback(null, userData);
    });
    
    ws.on('error', function(err) {
        callback(err);
    });
};

var findTempDirectory = function() {
	var defaultTempDirectory = '/tmp';
	var tempEnvironmentVariables = ['TMPDIR', 'TMP', 'TEMP'];

  for(var i = 0; i < tempEnvironmentVariables.length; i++) {
    var value = process.env[tempEnvironmentVariables[i]];
    if(value)
      return fs.realpathSync(value);
  }
  return fs.realpathSync(defaultTempDirectory);
};