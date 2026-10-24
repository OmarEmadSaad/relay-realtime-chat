// Values for the "status" field of every response (JSend format):
// SUCCESS - request worked (2xx)
// FAIL    - problem with the client's request, e.g. validation or not found (4xx)
// ERROR   - problem on the server (5xx)
export const SUCCESS = "success";
export const FAIL = "fail";
export const ERROR = "error";
