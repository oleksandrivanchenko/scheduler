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
    redis: null,
    mongo: null,
    workers: 5,
    retries: 3,
    retry_timeout: 1000
}