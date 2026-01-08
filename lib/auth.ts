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
      console.error("토큰 갱신 실패:", refreshedTokens);
      throw refreshedTokens;
    }

    console.log("토큰 갱신 성공!");

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("토큰 갱신 에러:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
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
  ],
  callbacks: {
    async jwt({ token, account }) {
      // 최초 로그인 시
      if (account) {
        console.log("최초 로그인 - 토큰 저장");
        return {
          ...token,
          accessToken: account.access_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000,
          refreshToken: account.refresh_token,
        };
      }

      // 토큰이 아직 유효하면 그대로 반환
      if (Date.now() < (token.accessTokenExpires as number)) {
        console.log("토큰 유효함");
        return token;
      }

      // 토큰 만료 시 갱신
      console.log("토큰 만료 - 갱신 시도");
      return refreshAccessToken(token);
    },

    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
