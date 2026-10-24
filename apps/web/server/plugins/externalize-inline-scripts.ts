import { externalizeInlineScripts } from "../utils/inline-scripts";

// Runs on every rendered page (dev server and production server), after Nuxt has
// appended its inline config script and before the HTML is serialized.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html) => {
    html.head = html.head.map(externalizeInlineScripts);
    html.bodyPrepend = html.bodyPrepend.map(externalizeInlineScripts);
    html.body = html.body.map(externalizeInlineScripts);
    html.bodyAppend = html.bodyAppend.map(externalizeInlineScripts);
  });
});
