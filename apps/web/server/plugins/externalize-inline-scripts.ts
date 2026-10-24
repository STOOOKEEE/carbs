import { externalizeInlineScripts } from "../utils/inline-scripts";

// Runs on every rendered page (dev server, Node server and prerender), after Nuxt has
// appended its inline config script and before the HTML is serialized. While prerendering
// the script body also travels with the page so that the build can write the file
// (see the prerender:generate hook in nuxt.config.ts).
export default defineNitroPlugin((nitroApp) => {
  const embed = import.meta.prerender;
  nitroApp.hooks.hook("render:html", (html) => {
    const rewrite = (chunk: string) => externalizeInlineScripts(chunk, embed);
    html.head = html.head.map(rewrite);
    html.bodyPrepend = html.bodyPrepend.map(rewrite);
    html.body = html.body.map(rewrite);
    html.bodyAppend = html.bodyAppend.map(rewrite);
  });
});
