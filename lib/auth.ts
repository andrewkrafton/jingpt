// lib/auth.ts
import AzureADProvider from "next-auth/providers/azure-ad";
import { NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_CLIENT_ID || "",
      clientSecret: process.env.AZURE_CLIENT_SECRET || "",
      tenantId: process.env.AZURE_TENANT_ID,
      // 💡 검색에 필요한 권한 범위를 명시합니다.
      authorization: { params: { scope: "openid profile email Files.Read.All Sites.Read.All" } },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // 💡 로그인 성공 시 받은 실제 토큰을 보관합니다.
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }: any) {
      // 💡 세션 객체에 토큰을 담아 API에서 꺼내 쓸 수 있게 합니다.
      session.accessToken = token.accessToken;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
