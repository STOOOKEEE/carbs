import { loadInlineScript } from "../../../utils/inline-scripts";

export default defineEventHandler((event) => {
  const body = loadInlineScript(getRouterParam(event, "file") ?? "");
  if (body === undefined) {
    throw createError({ statusCode: 404, statusMessage: "Unknown script" });
  }
  setResponseHeader(event, "content-type", "text/javascript; charset=utf-8");
  setResponseHeader(event, "cache-control", "no-store");
  return body;
});
