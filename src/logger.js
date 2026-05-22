function log(message, data) {
  if (data === undefined) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${message}`, data);
}

function logError(message, error) {
  if (error && error.isAxiosError) {
    const safeError = {
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.response?.status,
      response: error.response?.data
    };

    console.error(`[${new Date().toISOString()}] ${message}`, safeError);
    return;
  }

  console.error(`[${new Date().toISOString()}] ${message}`, error);
}

module.exports = { log, logError };
