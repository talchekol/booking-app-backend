// מילים שמורות שאסור להקצות כ-slug של עסק (מתנגשות עם נתיבי המערכת עצמה)
const RESERVED_SLUGS = [
  "admin",
  "api",
  "dashboard",
  "login",
  "register",
  "www",
  "support",
  "business",
  "appointments",
  "auth",
  "users",
  "check-slug",
  "my",
];

// אותיות אנגלית קטנות, ספרות ומקפים בלבד; לא מתחיל/מסתיים במקף; 3-30 תווים
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

const isValidSlugFormat = (slug) =>
  typeof slug === "string" && SLUG_REGEX.test(slug);

module.exports = { RESERVED_SLUGS, isValidSlugFormat };
