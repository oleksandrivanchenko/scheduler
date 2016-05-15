'use strict'

const MongoClient = require('mongodb').MongoClient

module.exports.init = function({ endpoint = 'mongodb://localhost:27017/eventdb' } = {}, cb) {
    MongoClient.connect(endpoint, (err, db) => {
        if (err) throw err
        let coll = db.collection('events')
        
        coll.createIndexes([
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
        ], (err, result) => {
            if (err) throw err
            module.exports.db = db
            cb()
        })
    })
}