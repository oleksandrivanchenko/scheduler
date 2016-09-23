'use strict';

const winston = require('winston');
const Settings = require('./settings');

// Winston Papertrail is weird, in that it attaches itself to the winston.transports object
//noinspection BadExpressionStatementJS
require('winston-papertrail').Papertrail;

const config = require('../config');

var winstonPapertrail = new winston.transports.Papertrail({
    host: Settings.papertrail.host,
    port: Settings.papertrail.port,
    colorize: true
});

winstonPapertrail.on('error', err => console.log(`Error connecting to Papertrail: ${err}`));

var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({ colorize: true }),
        winstonPapertrail
    ]
});

module.exports = logger;