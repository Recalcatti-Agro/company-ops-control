import brandingDefaults from "../../config/branding.json";

export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || brandingDefaults.companyName;
export const APP_TITLE = `${COMPANY_NAME} - ${brandingDefaults.appTitleSuffix}`;
export const APP_DESCRIPTION = brandingDefaults.appDescriptionTemplate.replace("{companyName}", COMPANY_NAME);
