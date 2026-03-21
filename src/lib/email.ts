import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const FROM = process.env.SMTP_FROM ?? "Taxímetro Digital <noreply@mnrs.com.br>";

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
    const baseUrl = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "https://mnrs.com.br").replace(/\/$/, "");
    const resetUrl = `${baseUrl}/taximetro/redefinir-senha/${token}`;

    await transporter.sendMail({
        from: FROM,
        to,
        subject: "Taxímetro Digital — Redefinição de Senha",
        html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 20px; color: #1E3A5F; margin: 0;">Taxímetro Digital</h1>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0;">SAMU 192 Salvador</p>
        </div>
        <p style="font-size: 15px; color: #334155;">Olá, <strong>${name}</strong>.</p>
        <p style="font-size: 15px; color: #334155;">Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #1E3A5F; color: #fff; font-size: 15px; font-weight: 600; padding: 12px 32px; border-radius: 8px; text-decoration: none;">
            Redefinir Senha
          </a>
        </div>
        <p style="font-size: 13px; color: #94a3b8;">Este link expira em <strong>1 hora</strong>. Se você não solicitou esta redefinição, ignore este e-mail.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">Se o botão não funcionar, copie e cole este link no navegador:<br/><a href="${resetUrl}" style="color: #64748b; word-break: break-all;">${resetUrl}</a></p>
      </div>
    `,
    });
}
