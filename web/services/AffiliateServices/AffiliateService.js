// import AffiliateUser from "../../schema/affiliateUserSchema.js";
// import CustomError from "../../utils/errorUtils.js";
// import logger from "../../utils/loggerUtils.js";
// import { sendEmail } from "../../utils/emailHelper.js";
// import { generateReferralCode } from "../../utils/referralUtils.js";
// import { OAuth2Client } from "google-auth-library";
// import { getReferralWelcomeEmailContent } from "../../Config/templates/referralTemplate.js";


// export class ReferralService {
//   constructor() {}

//   async generateReferralLink(details) {
//     try {
//       const { name, email, phone } = details;

//       const existingUser = await AffiliateUser.findOne({ email });
//       if (existingUser) {
//         return { message: "Generated referral link", data: existingUser };
//       }

//       const referralCode = generateReferralCode(name || email);
//       const user = await AffiliateUser.create({
//         name,
//         email,
//         phone,
//         referralCode,
//         referralLink: `https://zenmeraki.com/metamatrix-app?ref=${referralCode}`,
//       });

//       const emailContent = getReferralWelcomeEmailContent({
//         name,
//         referralCode,
//         user,
//       });

//       await sendEmail(
//         email,
//         "🎉 Welcome to MetaMatrix Referral Program - Start Earning Today!",
//         emailContent,
//         true
//       );

//       return { message: "Generated referral link", data: user };
//     } catch (err) {
//       throw new Error(
//         "Error generating Referral referral link: " + err.message
//       );
//     }
//   }

// }
