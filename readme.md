[![build status](https://secure.travis-ci.org/perfectapi/ami-generator.png)](http://travis-ci.org/perfectapi/ami-generator)
ami-generator
====
Generate Amazon AMI images easily.  This repository contains a collection of scripts that initialize your image to your specification.  The scripts are all contained in this repository.

Using without installing
------------------------
Go to http://amigen.perfectapi.com/ to try this out.


Helping out
-----------
If you would like to share your own scripts, or modify existing ones, please submit a Pull Request, or else email the team at amigen@perfectapi.com.  Currently, all scripts have to be bash scripts.


Terminology
-----------
* Image - an Amazon image, identified by an AMI id, e.g. `ami-af13d9c6`
* Instance - a running machine instance created from an image.  Can be run in various sizes (combinations of CPU/memory needs), e.g. "t1.micro" (the smallest)


Installing locally
----
There are two ways to use amigen - either as a library or as a command-line app.  To use as a library, install using npm within your own node.js project:

    $ npm install amigen

To install as a command-line application, use npm to install globally:

    $ sudo npm install -g amigen

Prerequisites
----
Before using, set two environment variables with your AWS keys:
`AWS_ACCESS_KEY_ID`
and `AWS_SECRET_ACCESS_KEY`
  
This allows the script to access AWS on you behalf (to generate the images).  

Usage - as command-line
----
The command-line app is named `amigen`.  It works from both Windows and Linux.  Typing:

	$ amigen --help
	
will output command-line help.  Typing:

	$ amigen scripts

will output a list of available scripts.

Usage - as library
----
Library usage goes something like this:

```javascript
var amigen = require('amigen');

var config = {   
        "root": "./node_modules/amigen/scripts"
    ,   "baseAMI": "ami-a562a9cc"
    ,   "scripts": ["ubuntu11.10/AWS_API_tools", "ubuntu11.10/nodejs-latest"]
    };
    
amigen.gen(config, function(err, result) {
    if (err) {
        console.log(err);
    } else {
        console.log('ok, done - amiId = ' + result.ami);
    }
});
```

Readme.txt
----------
The generated image will have a readme.txt in the default user's home folder.  This file contains notes from the script authors on how 
to make use of the included software.

It is recommended that you read this file by typing:

    $ cat readme.txt
  
(when you run an instance based off of the image).

Install.sh
----------
Depending on the scripts run, the generated image may have an install.sh script in the home folder.  Run this to complete the install:

    $ sudo ./install.sh
