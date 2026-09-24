import { clientEnv } from "@/lib/env";

/**
 * Transactional email.
 *
 * Rendered as inlined-style HTML with a plain-text twin, because email clients
 * are not browsers: no external stylesheet, no web font, no flexbox, tables for
 * layout. The palette matches the product so an email does not feel like it
 * came from a different company.
 */

const BRAND = "#1f4d3a";
const INK = "#1a1714";
const MUTED = "#665f55";
const PAPER = "#fbf9f5";
const LINE = "#e7e0d4";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(opts: {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}): string {
  const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
  <tr><td style="padding:28px 32px 0;">
    <a href="${appUrl}" style="text-decoration:none;color:${BRAND};font:700 20px/1 Georgia,serif;letter-spacing:-0.02em;">PetMate</a>
  </td></tr>
  <tr><td style="padding:20px 32px 0;">
    <h1 style="margin:0;font:600 24px/1.25 Georgia,serif;color:${INK};letter-spacing:-0.02em;">${escapeHtml(opts.heading)}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
    ${opts.body}
  </td></tr>
  ${
    opts.cta
      ? `<tr><td style="padding:26px 32px 0;">
    <a href="${opts.cta.url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 24px;border-radius:10px;">${escapeHtml(opts.cta.label)}</a>
  </td></tr>
  <tr><td style="padding:14px 32px 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#8a8274;word-break:break-all;">
    If the button does not work, paste this into your browser:<br>${escapeHtml(opts.cta.url)}
  </td></tr>`
      : ""
  }
  <tr><td style="padding:28px 32px 32px;">
    <hr style="border:none;border-top:1px solid ${LINE};margin:0 0 16px;">
    <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#8a8274;">
      ${opts.footerNote ? `${escapeHtml(opts.footerNote)}<br><br>` : ""}
      You are receiving this because you have a PetMate account.
      <a href="${appUrl}/settings/notifications" style="color:${MUTED};">Manage email preferences</a>.
    </p>
  </td></tr>
</table>
<p style="margin:20px 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#8a8274;">PetMate · Verified pets, verified people</p>
</td></tr></table>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;">${text}</p>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const emailTemplates = {
  verifyEmail(params: { name: string; url: string }): RenderedEmail {
    return {
      subject: "Confirm your email address",
      html: layout({
        preheader: "One click and your PetMate account is ready.",
        heading: `Welcome, ${escapeHtml(params.name)}`,
        body:
          p("Confirm your email address to finish setting up your account.") +
          p("Verified members get a trust badge, can message sellers, and can list a pet."),
        cta: { label: "Confirm email address", url: params.url },
        footerNote: "This link expires in 24 hours. If you did not create an account, ignore this email.",
      }),
      text: `Welcome to PetMate, ${params.name}.\n\nConfirm your email address:\n${params.url}\n\nThis link expires in 24 hours.`,
    };
  },

  passwordReset(params: { name: string; url: string; ip?: string | null }): RenderedEmail {
    return {
      subject: "Reset your PetMate password",
      html: layout({
        preheader: "A password reset was requested for your account.",
        heading: "Reset your password",
        body:
          p(`Hi ${escapeHtml(params.name)}, we received a request to reset your password.`) +
          p("Choose a new password using the button below.") +
          (params.ip ? p(`<span style="color:#8a8274;">Requested from ${escapeHtml(params.ip)}.</span>`) : ""),
        cta: { label: "Choose a new password", url: params.url },
        footerNote:
          "This link expires in 1 hour and can only be used once. If you did not request this, your password has not changed and no action is needed.",
      }),
      text: `Reset your PetMate password:\n${params.url}\n\nExpires in 1 hour. If you did not request it, ignore this email.`,
    };
  },

  passwordChanged(params: { name: string; url: string }): RenderedEmail {
    return {
      subject: "Your PetMate password was changed",
      html: layout({
        preheader: "Security notice for your account.",
        heading: "Your password was changed",
        body:
          p(`Hi ${escapeHtml(params.name)}, the password on your PetMate account was just changed, and every other signed-in device was signed out.`) +
          p("<strong>If this was not you</strong>, reset your password immediately and contact support."),
        cta: { label: "Review account security", url: params.url },
      }),
      text: `Your PetMate password was changed and all other sessions were signed out.\n\nIf this was not you: ${params.url}`,
    };
  },

  newMessage(params: {
    name: string;
    fromName: string;
    preview: string;
    url: string;
    context?: string;
  }): RenderedEmail {
    return {
      subject: `${params.fromName} sent you a message`,
      html: layout({
        preheader: params.preview.slice(0, 120),
        heading: `New message from ${escapeHtml(params.fromName)}`,
        body:
          (params.context ? p(`<span style="color:#8a8274;">About: ${escapeHtml(params.context)}</span>`) : "") +
          `<blockquote style="margin:0 0 12px;padding:12px 16px;background:${PAPER};border-left:3px solid ${BRAND};border-radius:6px;color:${INK};">${escapeHtml(params.preview)}</blockquote>`,
        cta: { label: "Reply on PetMate", url: params.url },
        footerNote: "Keep conversations and payments on PetMate — it is the only way we can protect you if something goes wrong.",
      }),
      text: `${params.fromName}: ${params.preview}\n\nReply: ${params.url}`,
    };
  },

  orderConfirmation(params: {
    name: string;
    orderNumber: string;
    total: string;
    itemCount: number;
    url: string;
  }): RenderedEmail {
    return {
      subject: `Order ${params.orderNumber} confirmed`,
      html: layout({
        preheader: `We have your order. Total ${params.total}.`,
        heading: "Order confirmed",
        body:
          p(`Thanks ${escapeHtml(params.name)} — your order is confirmed and the seller has been notified.`) +
          p(`<strong>Order ${escapeHtml(params.orderNumber)}</strong><br>${params.itemCount} item${params.itemCount === 1 ? "" : "s"} · ${escapeHtml(params.total)}`),
        cta: { label: "Track your order", url: params.url },
      }),
      text: `Order ${params.orderNumber} confirmed. ${params.itemCount} items, ${params.total}.\n\nTrack: ${params.url}`,
    };
  },

  appointmentConfirmed(params: {
    name: string;
    clinicName: string;
    petName: string;
    when: string;
    serviceName: string;
    url: string;
  }): RenderedEmail {
    return {
      subject: `Appointment confirmed — ${params.clinicName}`,
      html: layout({
        preheader: `${params.petName} is booked in for ${params.when}.`,
        heading: "Appointment confirmed",
        body:
          p(`${escapeHtml(params.petName)} is booked in at <strong>${escapeHtml(params.clinicName)}</strong>.`) +
          `<table role="presentation" style="margin:0 0 12px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;">
            <tr><td style="color:#8a8274;padding-right:16px;">Service</td><td style="color:${INK};">${escapeHtml(params.serviceName)}</td></tr>
            <tr><td style="color:#8a8274;padding-right:16px;">When</td><td style="color:${INK};"><strong>${escapeHtml(params.when)}</strong></td></tr>
          </table>`,
        cta: { label: "View appointment", url: params.url },
        footerNote: "Need to change it? You can reschedule or cancel free of charge up to 24 hours before.",
      }),
      text: `Appointment confirmed at ${params.clinicName} for ${params.petName}.\n${params.serviceName}\n${params.when}\n\n${params.url}`,
    };
  },

  appointmentReminder(params: {
    petName: string;
    clinicName: string;
    when: string;
    url: string;
  }): RenderedEmail {
    return {
      subject: `Reminder: ${params.petName} at ${params.clinicName} ${params.when}`,
      html: layout({
        preheader: `Appointment reminder for ${params.petName}.`,
        heading: "Appointment reminder",
        body: p(`${escapeHtml(params.petName)} is due at <strong>${escapeHtml(params.clinicName)}</strong> ${escapeHtml(params.when)}.`),
        cta: { label: "View details", url: params.url },
      }),
      text: `Reminder: ${params.petName} at ${params.clinicName} ${params.when}.\n${params.url}`,
    };
  },

  healthReminder(params: { petName: string; title: string; dueDate: string; url: string }): RenderedEmail {
    return {
      subject: `${params.petName}: ${params.title} is due`,
      html: layout({
        preheader: `Due ${params.dueDate}.`,
        heading: `${escapeHtml(params.petName)} has something due`,
        body:
          p(`<strong>${escapeHtml(params.title)}</strong> is due on ${escapeHtml(params.dueDate)}.`) +
          p("Booking it through PetMate adds the result to the pet's record automatically."),
        cta: { label: "Find a clinic", url: params.url },
      }),
      text: `${params.petName}: ${params.title} is due ${params.dueDate}.\n\nBook: ${params.url}`,
    };
  },

  breedingRequest(params: {
    fromName: string;
    fromPet: string;
    toPet: string;
    score: number;
    url: string;
  }): RenderedEmail {
    return {
      subject: `Breeding request for ${params.toPet}`,
      html: layout({
        preheader: `${params.fromName} would like to match ${params.fromPet} with ${params.toPet}.`,
        heading: "New breeding request",
        body:
          p(`${escapeHtml(params.fromName)} would like to match <strong>${escapeHtml(params.fromPet)}</strong> with your <strong>${escapeHtml(params.toPet)}</strong>.`) +
          p(`Compatibility score: <strong>${params.score}/100</strong> — open the request to see exactly how that was calculated.`),
        cta: { label: "Review request", url: params.url },
      }),
      text: `${params.fromName} wants to match ${params.fromPet} with ${params.toPet}. Compatibility ${params.score}/100.\n\n${params.url}`,
    };
  },

  adoptionDecision(params: {
    name: string;
    petName: string;
    approved: boolean;
    note?: string;
    url: string;
  }): RenderedEmail {
    return {
      subject: params.approved
        ? `Your application for ${params.petName} was approved`
        : `Update on your application for ${params.petName}`,
      html: layout({
        preheader: params.approved ? "Next steps inside." : "Thank you for applying.",
        heading: params.approved ? `Good news about ${escapeHtml(params.petName)}` : `Update on ${escapeHtml(params.petName)}`,
        body: params.approved
          ? p(`Your adoption application for <strong>${escapeHtml(params.petName)}</strong> has been approved. Message the current owner to arrange the next steps.`) +
            (params.note ? p(`<em>${escapeHtml(params.note)}</em>`) : "")
          : p(`Thank you for applying to adopt ${escapeHtml(params.petName)}. On this occasion the application was not taken forward.`) +
            (params.note ? p(`<em>${escapeHtml(params.note)}</em>`) : "") +
            p("There are other pets looking for a home, and your saved profile means the next application takes a minute."),
        cta: { label: params.approved ? "Open conversation" : "Browse pets for adoption", url: params.url },
      }),
      text: params.approved
        ? `Your application for ${params.petName} was approved.\n${params.url}`
        : `Your application for ${params.petName} was not taken forward.\n${params.url}`,
    };
  },

  payoutProcessed(params: { name: string; amount: string; url: string }): RenderedEmail {
    return {
      subject: `Payout of ${params.amount} sent`,
      html: layout({
        preheader: `${params.amount} is on its way.`,
        heading: "Payout sent",
        body: p(`Hi ${escapeHtml(params.name)}, a payout of <strong>${escapeHtml(params.amount)}</strong> has been sent to your registered account.`),
        cta: { label: "View earnings", url: params.url },
      }),
      text: `Payout of ${params.amount} sent.\n${params.url}`,
    };
  },

  generic(params: { heading: string; body: string; cta?: { label: string; url: string }; subject: string }): RenderedEmail {
    return {
      subject: params.subject,
      html: layout({
        preheader: params.body.slice(0, 120),
        heading: params.heading,
        body: p(escapeHtml(params.body)),
        cta: params.cta,
      }),
      text: `${params.heading}\n\n${params.body}${params.cta ? `\n\n${params.cta.url}` : ""}`,
    };
  },
};
