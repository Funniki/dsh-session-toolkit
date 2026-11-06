/**
 * The Session Enhancements pack.
 *
 * This package is a bundle (pack) only: its `cordis.patch.yml` inserts the
 * three component rows, each naming one original plugin package. The pack has
 * no plugin row of its own, so this module exists only to keep the package a
 * valid module entry; adding another component is a matter of appending one
 * `- id/name` row to `cordis.patch.yml` and installing that component package
 * into the profile (see README).
 *
 * @module dsh-session-toolkit
 */
export {};
