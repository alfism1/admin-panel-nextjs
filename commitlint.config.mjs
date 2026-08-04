/** @type {import("@commitlint/types").UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      [
        "auth",
        "rbac",
        "audit",
        "flags",
        "cache",
        "db",
        "ui",
        "users",
        "shell",
        "deps",
        "ci",
        "docs",
        "test",
      ],
    ],
  },
};

export default config;
