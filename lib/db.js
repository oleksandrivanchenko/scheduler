'use strict'

const client = require('mongodb').MongoClient

class Store extends client {
    constructor({ url = 'mongodb://localhost:27017/', db_name = 'tasksdb', collection = 'events' } = {}) {
        super()
        
        this.db = null
        this.url = url
        this.db_name = db_name
        this.collection = collection
    }
    
    init() {
        return new Promise((resolve, reject) => {
            this.connect(this.url + this.db_name, (err, db) => {
                this.db = db
                if (err) reject(err)
                else resolve()
            })
        })
    }
}

module.exports = new Store
