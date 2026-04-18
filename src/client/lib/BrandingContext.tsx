import React, { createContext, useContext } from "react";

const BrandingContext = createContext<string>("/icon.svg");

export function BrandingProvider({
  iconSrc,
  children
}: {
  iconSrc: string;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={iconSrc}>{children}</BrandingContext.Provider>;
}

export function useBrandIconSrc(): string {
  return useContext(BrandingContext);
}
