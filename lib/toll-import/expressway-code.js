const TOLL_PH_TO_APP_CODE = {
  "NLEX CONN": "NLEX_CONNECTOR",
  "NLEX HARBOR": "NLEX_HARBOR_LINK",
  SKYWAY3: "SKYWAY",
};

export function toAppExpresswayCode(sourceCode) {
  return TOLL_PH_TO_APP_CODE[sourceCode] ?? sourceCode;
}

export function sourceCodesForAppExpressway(appCode) {
  return Object.entries(TOLL_PH_TO_APP_CODE)
    .filter(([, mappedCode]) => mappedCode === appCode)
    .map(([sourceCode]) => sourceCode)
    .concat(appCode);
}
