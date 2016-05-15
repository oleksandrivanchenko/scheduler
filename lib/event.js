'use strict'

const coll = require('./db').db.collection('events')
 
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
    
    getHash() {
        return `${this.slug}:${this.key}`
    }
    
    // Uses ISODate format to represent date intervals
    recur() {
        return new Promise((resolve, reject) => {
            if (!this.recurring) return resolve(this)
            
            for (let i in this.recurring) {
                switch (i.toLowerCase()) {
                    case 'years':
                        this.run_at.setYear(this.run_at.getYear() + this.recurring[i])
                        break
                    case 'months':
                        this.run_at.setMonth(this.run_at.getMonth() + this.recurring[i])
                        break
                    case 'weeks':
                        this.run_at.setDate(this.run_at.getDate() + (this.recurring[i] * 7))
                        break
                    case 'days':
                        this.run_at.setDate(this.run_at.getDate() + this.recurring[i])
                        break
                    case 'hours':
                        this.run_at.setHours(this.run_at.getHours() + this.recurring[i])
                        break
                    case 'minutes':
                        this.run_at.setMinutes(this.run_at.getMinutes() + this.recurring[i])
                        break
                    case 'seconds':
                        this.run_at.setSeconds(this.run_at.getSeconds() + this.recurring[i])
                        break
                    case 'milliseconds':
                        this.run_at.setMilliseconds(this.run_at.getMilliseconds() + this.recurring[i])
                        break
                    default:
                        break
                }
            }
            
            this
                .save({ run_at: this.run_at })
                .then(resolve)
                .catch(reject)
                
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
                resolve(this)
            })
        })
    }
}

Event.fetch = (slug, key) => {
    return new Promise((resolve, reject) => {
        this.collection.find({
            slug: slug,
            key: key
        }).limit(1).next((err, result) => {
            if (err) reject(err)
            else resolve(new Event(result))
        })
    })
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
console.log(err, events) 
            if (err) reject(err)
            else resolve(events.map(e => { return new Event(e) }))
        })
    })
}

module.exports = Event