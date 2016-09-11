'use strict'

/**
 * This is meant for global settings access.
 * User-defined settings are loaded in index.js
 */

module.exports = {
    port: 5665,
    interval: 60,
    verbose: true,
    upsert: false,
    hash_delimiter: '::',
    redis: {
        queue_name: 'scheduler-job-queue',
        ordered_set_name: 'scheduler-job-set'
    },
    mongo: {
        endpoint: null,
        host: 'localhost',
        port: 27017,
        db_name: 'eventdb',
        collection_name: 'events'
    },
    workers: 5,
    retries: 3,
    retry_timeout: 1000
}