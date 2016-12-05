#!/usr/bin/env node

var winston = require('winston');
winston.loggers.add('amigen-console', {
	console: {
		level: 'info',
		colorize: 'true'
	}
});
var logger = winston.loggers.get('amigen-console');

var perfectapi = require('perfectapi');    
//var perfectapi = require('../../perfectapi/api.js');  
var gen = require('../modules/generator/generator.js');
var regions = require('../modules/ec2info/regions.js');
var path = require('path');
var fs = require('fs');


var configPath = path.resolve(__dirname, '..', 'perfectapi.json');
var parser = new perfectapi.Parser();
parser.on("gen", function(config, callback) {
	config = validateRootpath(config, function(err, config) {
		if (err) {
			callback(err, null);
		} else {
			logger.info('generating...');

			gen.getImageUsingConfig(config, function(err, amiId) {
				if (err) {
					callback(err);
				} else {
					var result = {};
					result.ami = amiId;
					result.region = config.options.region;
					logger.info('ok, done - amiId = ' + amiId + ' in region ' + result.region);
					
					callback(null, result);
				}
			});
		}
	});
});
 
parser.on("scripts", function(config, callback) {
	config = validateRootpath(config, function(err, config) {
		if (err) {
			callback(err, null);
		} else {
			var options = config.options;
		
			var paths = [];
			walkPathSync(options.root, '', paths);
			
			var result = {};
			result.scripts = paths.sort(function(A,B) {
				var a=A.toLowerCase(), b=B.toLowerCase();
				if (a < b) return -1;
				if (b < a) return 1;
				return 0;
			});
			callback(null, result);			
		}
	});
});

parser.on("regions", function(config, callback) {
	regions(config, callback);
});

//expose our API
module.exports = parser.parse(configPath);

function validateRootpath(config, callback) {
	var options = config.options;
	options.root = options.root || path.resolve(__dirname, '../scripts');

	if (!fs.existsSync(options.root)) {		
		callback('Scripts path "' + options.root + '" does not exist');
	} else {
		callback(null, config);
	}
}

function walkPathSync(root, currentPath, results) {
	results = results || [];
	
	var files = fs.readdirSync(path.resolve(root, currentPath));
	for (var i=0;i<files.length;i++) {
		var currentFileResolved = path.resolve(root, currentPath, files[i]);
		var isDir = fs.statSync(currentFileResolved).isDirectory();
		
		if (isDir) {
			var result = path.join(currentPath, files[i])
			if (fs.existsSync(path.resolve(currentFileResolved, 'user-data.sh'))) {
				results.push(result);
				walkPathSync(root, result, results);
			}
		}
	}
}

