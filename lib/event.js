'use strict'

const coll = require('./db').collection('events')

class Event {
    constructor(slug, key, { 
        endpoint,
        run_at,
        recurring = false,
        payload = {},
        fail_count
    } = {}) {
        this.slug = slug
        this.key = key
        this.endpoint = endpoint
        this.recurring = recurring
        this.run_at = new Date(run_at),
        this.fail_count = fail_count
        this.payload = payload
    }
    
    destroy() {
        return new Promise((resolve, reject) => {
            coll.removeOne({
                slug: this.slug,
                key: this.key
            }, (err, result) => {
                if (err) reject(err)
                else resolve(result.deletedCount > 0)
            })
        })
    }
    
    save(changes) {
        if (!changes) {
            changes = {}
            for (let i of Object.keys(this)) {
                changes[i] = this[i]
            }
        }
        
        return new Promise((resolve, reject) => {
            coll.findOneAndUpdate({
                slug: this.slug,
                key: key
            }, {
                $set: changes
            }, {
                upsert: changes,
                returnOriginal: false
            }, (err, result) => {
                if (err) return reject(err)
                for (let i in result) {
                    if (result.hasOwnProperty(i)) {
                        this[i] = result[i]
                    }
                }
                resolve()
            })
        })
    }
}

Event.fetch = (slug, key) => {
    
}

Event.list = (before, after) => {
    return new Promise((resolve, reject) => {
        let query = {}
        
        if (before || after) {
            if (before) {
                query.$lte = new Date(before)
            }
            if (after) {
                query.$gte = new Date(after)
            }
        } else {
            query.$lte = Date.now() + this.interval
        }
        
        this.collection.find({
            run_at: query
        }).toArray((err, events) => {
            if (err) return reject(err)
            else return resolve(events.map(e => { return new Event(e) }))
        })
    })
}

module.exports = Event