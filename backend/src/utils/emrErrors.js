export function isEmrSqlTimeout(text = "") {
  return /execution timeout expired|timeout period elapsed|not responding/i.test(String(text));
}

export function formatEmrHttpError(status, text = "") {
  const body = String(text);
  if (isEmrSqlTimeout(body)) {
    return {
      code: "EMR_SQL_TIMEOUT",
      message:
        "EMR database query timed out. The HIS server could not finish loading that date in time. Try again in a minute, switch to today, or search by order ID.",
    };
  }
  return {
    code: "EMR_HTTP_ERROR",
    message: `EMR HTTP ${status}: ${body.slice(0, 280)}`,
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
