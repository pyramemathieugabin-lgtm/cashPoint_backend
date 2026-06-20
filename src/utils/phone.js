const USER_PHONE_PREFIXES = ["034", "038", "032", "037", "033"];

const OPERATOR_PHONE_PREFIXES = {
  YAS: ["034", "038"],
  ORANGE: ["032", "037"],
  AIRTEL: ["033"],
};

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "").slice(0, 10);

const isValidPhoneForPrefixes = (phone, prefixes) => /^\d{10}$/.test(phone) && prefixes.some((prefix) => phone.startsWith(prefix));

const validateUserPhone = (phone) => {
  const cleanPhone = normalizePhone(phone);
  if (!isValidPhoneForPrefixes(cleanPhone, USER_PHONE_PREFIXES)) {
    throw new Error("Le numero telephone doit contenir 10 chiffres et commencer par 034, 038, 032, 037 ou 033.");
  }
  return cleanPhone;
};

const validateOperatorPhone = (phone, operator) => {
  const cleanPhone = normalizePhone(phone);
  const prefixes = OPERATOR_PHONE_PREFIXES[operator] || USER_PHONE_PREFIXES;
  if (!isValidPhoneForPrefixes(cleanPhone, prefixes)) {
    throw new Error(`Le numero client doit contenir 10 chiffres et commencer par ${prefixes.join(" ou ")}.`);
  }
  return cleanPhone;
};

module.exports = {
  USER_PHONE_PREFIXES,
  OPERATOR_PHONE_PREFIXES,
  normalizePhone,
  validateUserPhone,
  validateOperatorPhone,
};
