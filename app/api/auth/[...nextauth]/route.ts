import NextAuth from "next-auth";
import { authOptions } from "../../../../lib/auth"; // 단축키 대신 직접 경로 입력

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
