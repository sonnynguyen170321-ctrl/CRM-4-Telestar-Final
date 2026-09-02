import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type PhoneIntelligence = {
  isValid: boolean;
  countryCode: string | null;
  type: "MOBILE" | "FIXED_LINE" | "TOLL_FREE" | "UNKNOWN";
};

/**
 * Phân tích và kiểm định cấu trúc của số điện thoại sử dụng libphonenumber-js.
 */
export function analyzePhoneNumber(phone: string, defaultCountry: CountryCode = "VN"): PhoneIntelligence {
  const cleanPhone = phone.trim();
  if (!cleanPhone) {
    return { isValid: false, countryCode: null, type: "UNKNOWN" };
  }

  const parsed = parsePhoneNumberFromString(cleanPhone, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return { isValid: false, countryCode: null, type: "UNKNOWN" };
  }

  const type = parsed.getType();
  let mappedType: PhoneIntelligence["type"] = "UNKNOWN";

  if (type === "MOBILE") {
    mappedType = "MOBILE";
  } else if (type === "FIXED_LINE") {
    mappedType = "FIXED_LINE";
  } else if (type === "TOLL_FREE") {
    mappedType = "TOLL_FREE";
  }

  return {
    isValid: true,
    countryCode: parsed.country ?? null,
    type: mappedType,
  };
}
