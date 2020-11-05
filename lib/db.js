'use strict'

const Promise = require('bluebird')
const mongodb = require('mongodb')
const Settings = require('./settings')

Promise.promisifyAll(mongodb)

const MongoClient = require('mongodb').MongoClient

module.exports.init = function(cb) {
    return MongoClient
        .connectAsync(Settings.mongo.endpoint || `mongodb://${Settings.mongo.username}:${Settings.mongo.password}@${Settings.mongo.host}:${Settings.mongo.port}/${Settings.mongo.db_name}?authSource=admin`)
        .then(db => {
            module.exports.db = db
            return db.collection(Settings.mongo.collection_name).createIndexesAsync([
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