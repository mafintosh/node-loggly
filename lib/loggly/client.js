/*
 * client.js: Core client functions for accessing Loggly
 *
 * (C) 2010 Nodejitsu Inc.
 * MIT LICENSE
 *
 */

var events = require('events'),
    util = require('util'),
    qs = require('querystring'),
    common = require('./common'),
    loggly = require('../loggly'),
    Search = require('./search').Search;

//
// function createClient (options)
//   Creates a new instance of a Loggly client.
//
exports.createClient = function (options) {
  return new Loggly(options);
};

//
// ### function Loggly (options)
// #### @options {Object} Options for this Loggly client
// ####   @subdomain
// ####   @token
// ####   @json
// ####   @auth
// ####   @tags
// Constructor for the Loggly object
//
var Loggly = exports.Loggly = function (options) {
  if (!options || !options.subdomain || !options.token) {
    throw new Error('options.subdomain and options.token are required.');
  }

  events.EventEmitter.call(this);

  this.subdomain = options.subdomain;
  this.token     = options.token;
  this.host      = options.host || 'logs-01.loggly.com';
  this.json      = options.json || null;
  this.auth      = options.auth || null;
  this.userAgent = 'node-loggly ' + loggly.version

  //
  // Set the tags on this instance.
  //
  this.tags(options.tags);

  var url   = 'https://' + this.host,
      api   = options.api  || 'apiv2';

  this.urls = {
    default: url,
    log:     [url, 'inputs', this.token].join('/'),
    api:     'https://' + [this.subdomain, 'loggly', 'com'].join('.') + '/' + api
  };
};

//
// Inherit from events.EventEmitter
//
util.inherits(Loggly, events.EventEmitter);

//
// ### function log (msg, tags, callback)
// #### @msg {string|Object} Data to log
// #### @tags {Array} **Optional** Tags to send with this msg
// #### @callback {function} Continuation to respond to when complete.
// Logs the message to the token associated with this instance. If
// the message is an Object we will attempt to serialize it. If any
// `tags` are supplied they will be passed via the `X-LOGGLY-TAG` header.
//  - http://www.loggly.com/docs/api-sending-data/
//
Loggly.prototype.log = function (msg, tags, callback) {
  if (!callback && typeof tags === 'function') {
    callback = tags;
    tags = null;
  }

  if (msg instanceof Object) {
    msg = this.json ? JSON.stringify(msg) : common.serialize(msg);
  }
  else {
    msg = this.json ? JSON.stringify({ message : msg }) : msg;
  }

  var self = this,
      logOptions;

  logOptions = {
    uri:     this.urls.log,
    method:  'POST',
    body:    msg,
    headers: {
      'host':           this.host,
      'accept':         '*/*',
      'user-agent':     this.userAgent,
      'content-type':   this.json ? 'application/json' : 'text/plain',
      'content-length': msg.length
    }
  };

  //
  // Optionally send `X-LOGGLY-TAG` defaulting to the tags
  // set on this instance.
  //
  tags = tags || this.tags;
  if (Array.isArray(tags)) {
    logOptions.headers['x-loggly-tag'] = tags.join(',');
  }

  common.loggly(logOptions, callback, function (res, body) {
    try {
      var result = JSON.parse(body);
      self.emit('log', result);
      if (callback) {
        callback(null, result);
      }
    }
    catch (ex) {
      if (callback) {
        callback(new Error('Unspecified error from Loggly: ' + ex));
      }
    }
  });

  return this;
};

//
// ### function tag (tags)
// #### @tags {Array} Tags to use for `X-LOGGLY-TAG`
// Sets the tags on this instance
//
Loggly.prototype.tags = function (tags) {
  //
  // TODO: Filter against valid tag names
  // http://www.loggly.com/docs/tags/
  //
  this.tags = tags;
};


//
// ### function customer (callback)
// ### @callback {function} Continuation to respond to.
// Retrieves the customer information from the Loggly API:
//   - http://www.loggly.com/docs/api-account-info/
//
Loggly.prototype.customer = function (callback) {
  common.loggly({
    uri: this.logglyUrl('customer'),
    auth: this.auth
  }, callback, function (res, body) {
    var customer;
    try { customer = JSON.parse(body) }
    catch (ex) { return callback(ex) }
    callback(null, customer);
  });
};

//
// function search (query, callback)
//   Returns a new search object which can be chained
//   with options or called directly if @callback is passed
//   initially.
//
// Sample Usage:
//
//   client.search('404', function () { /* ... */ })
//         .on('rsid', function (rsid) { /* ... */ })
//
//   client.search({ query: '404', rows: 100 })
//         .on('rsid', function (rsid) { /* ... */ })
//         .run(function () { /* ... */ });
//
Loggly.prototype.search = function (query, callback) {
  var options = typeof query === 'string'
    ? { query: query }
    : query;

  options.callback = callback;
  return new Search(options, this);
};

//
// function logglyUrl ([path, to, resource])
//   Helper method that concats the string params into a url
//   to request against a loggly serverUrl.
//
Loggly.prototype.logglyUrl = function (/* path, to, resource */) {
  var args = Array.prototype.slice.call(arguments);
  return [this.urls.api].concat(args).join('/');
};