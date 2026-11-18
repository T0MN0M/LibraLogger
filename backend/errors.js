// An error whose message is safe to show the user. server.js turns it into
// { error: message } with the given HTTP status; anything else becomes a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
