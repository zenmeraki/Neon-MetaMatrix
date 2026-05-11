export function getReferralEmailContent({
  referredUser,
  shop,
  installationDate = new Date(),
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Congratulations!</h1>
        <p style="color: white; margin: 10px 0 0 0; font-size: 18px;">You've earned a new referral!</p>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; border-left: 4px solid #28a745;">
        <h2 style="color: #333; margin-top: 0;">New Store Installation</h2>
        <p>Hi ${referredUser.name},</p>
        
        <p>Exciting news! A store has just installed MetaMatrix using your referral link.</p>
        
        <div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">Installation Details:</h3>
          <p><strong>Store Name:</strong> ${shop}</p>
          <p><strong>Installation Date:</strong> ${new Date(
            installationDate
          ).toLocaleDateString()}</p>
          <p><strong>Your Referral Code:</strong> ${
            referredUser.referralCode
          }</p>
        </div>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="font-size: 16px; color: #333;">Keep sharing your referral link to earn more commissions!</p>
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #1976d2;">Your Referral Link:</p>
          <a href="${
            referredUser.referralLink
          }" style="color: #1976d2; text-decoration: none; word-break: break-all;">
            ${referredUser.referralLink}
          </a>
        </div>
      </div>
      
      <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; color: #856404;">
          <strong>💰 Commission Eligibility:</strong> You'll earn your reward if this store subscribes to any paid plan within 30 days of installation. We'll notify you via email once they subscribe and your commission is confirmed.
        </p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      
      <div style="text-align: center;">
        <p style="color: #666; font-size: 14px;">Thank you for being part of the MetaMatrix affiliate program!</p>
        <p style="color: #666; font-size: 12px;">
          If you have any questions about your referral or commission, please contact our support team.
        </p>
      </div>
    </div>
  `;
}

export function getCommissionEarnedEmailContent({
  referredUser,
  shop,
  planName,
  commissionAmount,
  subscriptionDate = new Date(),
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
        <h1 style="color: white; margin: 0; font-size: 28px;">💸 Commission Earned!</h1>
        <p style="color: white; margin: 10px 0 0 0; font-size: 18px;">Your referral just subscribed!</p>
      </div>
      
      <div style="background-color: #d4edda; padding: 25px; border-radius: 8px; border-left: 4px solid #28a745;">
        <h2 style="color: #155724; margin-top: 0;">🎉 Subscription Confirmed</h2>
        <p>Hi ${referredUser.name},</p>
        
        <p>Fantastic news! The store you referred has subscribed to a MetaMatrix plan within the 30-day window. Your commission has been earned!</p>
      </div>
      
      <div style="background-color: white; border: 2px solid #28a745; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0; text-align: center;">Subscription Details</h3>
        <div style="text-align: center;">
          <p><strong>Store Name:</strong> ${shop}</p>
          <p><strong>Subscription Date:</strong> ${new Date(
            subscriptionDate
          ).toLocaleDateString()}</p>
          <p><strong>Plan:</strong> ${planName}</p>
          <p><strong>Your Referral Code:</strong> ${
            referredUser.referralCode
          }</p>
        </div>
      </div>
      
      <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 6px; margin: 20px 0;">
        <h3 style="color: #0c5460; margin-top: 0;">💰 Commission Information</h3>
        <p style="margin: 0; color: #0c5460;">
          <strong>Status:</strong> Commission Earned ✅<br>
          <strong>Amount:</strong> ${commissionAmount || "To be calculated"}<br>
          <strong>Payment:</strong> We will connect with you within 7 days to process your payment
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="font-size: 16px; color: #333;">Keep up the great work! Share your referral link to earn more commissions.</p>
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #1976d2;">Your Referral Link:</p>
          <a href="${
            referredUser.referralLink
          }" style="color: #1976d2; text-decoration: none; word-break: break-all;">
            ${referredUser.referralLink}
          </a>
        </div>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; color: #495057; font-size: 14px;">
          <strong>📋 Next Steps:</strong><br>
          • Our team will reach out to you within 7 days for payment processing<br>
          • Please ensure your contact information is up to date<br>
          • Keep sharing your link to earn more commissions
        </p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      
      <div style="text-align: center;">
        <p style="color: #666; font-size: 14px;">Congratulations on your successful referral! 🎊</p>
        <p style="color: #666; font-size: 12px;">
          Questions about your commission? Contact our support team anytime.
        </p>
      </div>
    </div>
  `;
}

export function getReferralWelcomeEmailContent({
  name = "there",
  referralCode,
  user,
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <!-- Header with Logo -->
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
        <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="MetaMatrix Logo" style="width: 60px; height: 60px; margin-bottom: 15px; border-radius: 8px;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to MetaMatrix!</h1>
        <p style="color: white; margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your Referral Journey Starts Here</p>
      </div>
      
      <!-- Main Content -->
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 25px;">
          <h2 style="color: #333; margin: 0 0 10px 0;">🎉 Referral Program Activated!</h2>
        </div>
        
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        
        <p style="color: #555; line-height: 1.6;">Welcome to the MetaMatrix Referral Program! We're excited to have you as part of our growing community of partners.</p>
        
        <p style="color: #555; line-height: 1.6;">Your personalized referral link has been successfully generated and is ready to use. Start sharing and earning today!</p>
        
        <!-- Referral Details Card -->
        <div style="background: linear-gradient(135deg, #f8f9ff 0%, #e3f2fd 100%); border: 2px solid #2196F3; padding: 25px; border-radius: 12px; margin: 25px 0;">
          <h3 style="margin: 0 0 20px 0; color: #1976D2; text-align: center;">📋 Your Referral Details</h3>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p style="margin: 0 0 5px 0; color: #666; font-size: 14px;">Referral Code:</p>
            <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; color: #1976D2;">${referralCode}</p>
          </div>
          
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">Your Referral Link:</p>
            <a href="${user.referralLink}" style="color: #1976D2; text-decoration: none; word-break: break-word; font-size: 14px; background-color: #f5f5f5; padding: 8px; border-radius: 4px; display: block;">${user.referralLink}</a>
          </div>
        </div>
        
        <!-- How It Works -->
        <div style="background-color: #f8fffe; border-left: 4px solid #00C851; padding: 20px; border-radius: 0 8px 8px 0; margin: 25px 0;">
          <h3 style="color: #00695C; margin: 0 0 15px 0;">💰 How You Earn</h3>
          <div style="color: #555; line-height: 1.6;">
            <p style="margin: 0 0 8px 0;">• Share your referral link with Shopify store owners</p>
            <p style="margin: 0 0 8px 0;">• They install MetaMatrix using your link</p>
            <p style="margin: 0 0 8px 0;">• If they subscribe to a paid plan within 30 days - you earn!</p>
            <p style="margin: 0;">• We'll notify you and connect within 7 days for payment</p>
          </div>
        </div>
        
        <!-- Call to Action -->
        <div style="text-align: center; margin: 30px 0;">
          <div style="background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); padding: 20px; border-radius: 10px; color: white;">
            <h3 style="margin: 0 0 10px 0;">🚀 Ready to Start Earning?</h3>
            <p style="margin: 0 0 15px 0; opacity: 0.9;">Copy your referral link and start sharing with store owners who need powerful Shopify automation!</p>
            <p style="margin: 0; font-size: 14px; opacity: 0.8;">The more you share, the more you earn!</p>
          </div>
        </div>
        
        <!-- Tips Section -->
        <div style="background-color: #fff3e0; border: 1px solid #ffcc02; padding: 20px; border-radius: 8px; margin: 25px 0;">
          <h3 style="color: #f57c00; margin: 0 0 15px 0;">💡 Pro Tips for Success</h3>
          <div style="color: #555; font-size: 14px; line-height: 1.5;">
            <p style="margin: 0 0 8px 0;">• Target e-commerce communities and Shopify groups</p>
            <p style="margin: 0 0 8px 0;">• Share how MetaMatrix solves real store automation problems</p>
            <p style="margin: 0 0 8px 0;">• Follow up with contacts who show interest</p>
            <p style="margin: 0;">• Track your link performance and optimize your approach</p>
          </div>
        </div>
      </div>
      
      <!-- Footer -->
      <div style="text-align: center; margin: 30px 0 0 0; padding: 20px; color: #666;">
        <p style="margin: 0 0 10px 0; font-size: 14px;">Questions about the referral program?</p>
        <p style="margin: 0 0 20px 0; font-size: 14px;">Contact our support team - we're here to help!</p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; margin: 0;">
          If you didn't sign up for this program, please ignore this email or contact our support team.
        </p>
      </div>
    </div>
  `;
}
