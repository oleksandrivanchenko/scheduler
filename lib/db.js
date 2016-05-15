'use strict'

const MongoClient = require('mongodb').MongoClient

class DBClient {
    constructor({ endpoint = 'mongodb://localhost:27017/eventdb' } = {}) {
        this.db = null
        this.endpoint = endpoint
    }
    
    init(cb) {
        MongoClient.connect(this.endpoint, (err, db) => {
            if (err) throw err
            this.db = db
            cb()
        })
    }
}
    
module.exports = options => { return new DBClient(options) }