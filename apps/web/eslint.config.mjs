import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt({
  rules: {
    // Nuxt names pages and layouts after their files (index, session, default), and Silk is one word.
    "vue/multi-word-component-names": "off",
  },
});
