export function errorHandler(err, req, res, next) {
    console.error(err.stack)
    res.status(err.status || 500).json({
        error: err.message || 'An unexpected error occurred',
    })
}

// If anything crashes anywhere in the backend, this catches it and sends a clean error message back to the browser. 
// Without this, the browser would just hang or get a confusing raw crash message.