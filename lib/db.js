'use strict'

const Promise = require('bluebird')
const mongodb = require('mongodb')
const Settings = require('./settings')

Promise.promisifyAll(mongodb)

const MongoClient = require('mongodb').MongoClient

module.exports.init = function(cb) {
    return MongoClient
        .connectAsync(Settings.mongo_endpoint || 'mongodb://localhost:27017/eventdb')
        .then(db => {
            module.exports.db = db
            return db.collection('events').createIndexes([
                {
                    name: 'index-unique-event',
                    unique: true,
                    key: {
                        slug: 1,
                        key: 1
                    }
                },
                {
                    name: 'index-reverse-cron',
                    key: {
                        run_at: -1
                    }
                }
            ])
        })
}