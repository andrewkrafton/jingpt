import AzureADProvider from "next-auth/providers/azure-ad";
import { NextAuthOptions } from "next-auth";

async function refreshAccessToken(token: any) {
  try {
    const url = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_CLIENT_ID || "",
        client_secret: process.env.AZURE_CLIENT_SECRET || "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        scope: "openid profile email Files.Read.All Sites.Read.All offline_access",
      }),
    });
    const refreshedTokens = await response.json();
    if (!response.ok) {
      console.error("Azure 토큰 갱신 실패:", refreshedTokens);
      throw refreshedTokens;
    }
    console.log("Azure 토큰 갱신 성공!");
    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("Azure 토큰 갱신 에러:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

async function refreshAtlassianToken(token: any) {
  try {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        refresh_token: token.atlassianRefreshToken,
      }),
    });
    const refreshedTokens = await response.json();
    if (!response.ok) {
      console.error("Atlassian 토큰 갱신 실패:", refreshedTokens);
      throw refreshedTokens;
    }
    console.log("Atlassian 토큰 갱신 성공!");
    return {
      ...token,
      atlassianAccessToken: refreshedTokens.access_token,
      atlassianAccessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      atlassianRefreshToken: refreshedTokens.refresh_token ?? token.atlassianRefreshToken,
    };
  } catch (error) {
    console.error("Atlassian 토큰 갱신 에러:", error);
    return {
      ...token,
      atlassianError: "RefreshAtlassianTokenError",
    };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_CLIENT_ID || "",
      clientSecret: process.env.AZURE_CLIENT_SECRET || "",
      tenantId: process.env.AZURE_TENANT_ID,
      authorization: {
        params: {
          scope: "openid profile email Files.Read.All Sites.Read.All offline_access",
        },
      },
    }),
    {
      id: "atlassian",
      name: "Atlassian",
      type: "oauth",
      authorization: {
        url: "https://auth.atlassian.com/authorize",
        params: {
          audience: "api.atlassian.com",
          scope: "read:confluence-space.summary read:confluence-content.all read:confluence-content.summary search:confluence offline_access",
          prompt: "consent",
        },
      },
      token: "https://auth.atlassian.com/oauth/token",
      userinfo: "https://api.atlassian.com/me",
      clientId: process.env.ATLASSIAN_CLIENT_ID,
      clientSecret: process.env.ATLASSIAN_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.account_id,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Azure AD 로그인 시
      if (account?.provider === "azure-ad") {
        console.log("Azure AD 로그인 - 토큰 저장");
        return {
          ...token,
          accessToken: account.access_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000,
          refreshToken: account.refresh_token,
          provider: "azure-ad",
        };
      }

      // Atlassian 로그인 시
      if (account?.provider === "atlassian") {
        console.log("Atlassian 로그인 - 토큰 저장");
        return {
          ...token,
          atlassianAccessToken: account.access_token,
          atlassianAccessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000,
          atlassianRefreshToken: account.refresh_token,
          provider: "atlassian",
        };
      }

      // Azure 토큰 갱신 체크
      if (token.accessToken && Date.now() >= (token.accessTokenExpires as number)) {
        console.log("Azure 토큰 만료 - 갱신 시도");
        const refreshedToken = await refreshAccessToken(token);
        token = { ...token, ...refreshedToken };
      }

      // Atlassian 토큰 갱신 체크
      if (token.atlassianAccessToken && Date.now() >= (token.atlassianAccessTokenExpires as number)) {
        console.log("Atlassian 토큰 만료 - 갱신 시도");
        const refreshedToken = await refreshAtlassianToken(token);
        token = { ...token, ...refreshedToken };
      }

      return token;
    },
    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.atlassianAccessToken = token.atlassianAccessToken;
      session.error = token.error;
      session.atlassianError = token.atlassianError;
      session.provider = token.provider;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
