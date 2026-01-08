import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    atlassianAccessToken?: string;
    error?: string;
    atlassianError?: string;
    provider?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    accessTokenExpires?: number;
    refreshToken?: string;
    atlassianAccessToken?: string;
    atlassianAccessTokenExpires?: number;
    atlassianRefreshToken?: string;
    error?: string;
    atlassianError?: string;
    provider?: string;
  }
}
