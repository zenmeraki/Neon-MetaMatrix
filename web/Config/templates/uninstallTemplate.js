export const uninstallFeedbackHTML = (userName, shopDomain, storeName) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8f9fa; padding: 20px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%); color: white; padding: 30px; text-align: center;">
        <div style="margin-bottom: 15px;">
          <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="ZenMeraki Logo" style="width: 48px; height: 48px; border-radius: 8px; vertical-align: middle;">
        </div>
        <h1 style="margin: 0; font-size: 28px; font-weight: 600;">
          We're Sorry to See You Go
        </h1>
        <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">
          ${userName ? `Hi ${userName}` : "Hello there"} 👋
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 40px 30px;">
        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">
          💔 Thank you for trying Metamatrix
        </h2>
         <!-- Call to Action -->
        <div style="text-align: center; margin: 35px 0;">
          <a href="https://zenmeraki.com/contact" target="_blank" rel="noopener noreferrer"  style="display: inline-block; 
          background-color: #4a90e2; 
          color: white; 
          text-decoration: none; 
          padding: 15px 30px; 
          border-radius: 6px; 
          font-weight: 600; 
          font-size: 16px; 
          margin-bottom: 15px;">
            💬 Share Your Feedback (2 min)
          </a>
          <p style="color: #777; font-size: 14px; margin: 15px 0 0 0;">
            Quick anonymous survey to help us improve
          </p>
        </div>
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          We noticed that you recently uninstalled Metamatrix from ${
            storeName || shopDomain
          }. While we're disappointed to see you go, we completely understand that every store has unique needs.
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
          Your experience matters to us, and we'd love to learn from your feedback to make Metamatrix better for future users.
        </p>

        <!-- Feedback Request -->
        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">
            🤔 Help Us Improve - Your Feedback Matters
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
            Could you spare 2 minutes to help us understand what didn't work for you? Your insights will help us serve merchants better.
          </p>
          
          <!-- Feedback Categories -->
          <div style="color: #555; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Common reasons merchants uninstall:</p>
            <ul style="margin: 0; padding-left: 20px;">
              <li>App didn't meet specific needs</li>
              <li>Too complex or confusing to use</li>
              <li>Performance or technical issues</li>
              <li>Pricing concerns</li>
              <li>Found a better alternative</li>
              <li>No longer needed bulk editing</li>
            </ul>
          </div>
        </div>

       

        <!-- Alternative Support -->
        <div style="background-color: #e8f4fd; border-left: 4px solid #4a90e2; padding: 20px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🔄 Changed Your Mind? We're Here to Help!
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
            If you uninstalled due to a technical issue or confusion, our support team might be able to help you get back on track. We're committed to your success!
          </p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="mailto:zenmerakihelp@gmail.com?subject=Need Help with Metamatrix - ${shopDomain}" style="display: inline-block; background-color: #28a745; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 14px; margin-right: 10px;">
              🆘 Get Support
            </a>
            <a href="https://zenmeraki.com/metamatrix-app" style="display: inline-block; background-color: #6c757d; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 14px;">
              🔄 Reinstall App
            </a>
          </div>
        </div>

        <!-- What We Offered -->
        <div style="border: 1px solid #e9ecef; border-radius: 8px; padding: 25px; margin: 30px 0; background-color: #fff;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; text-align: center;">
            🔍 What You'll Miss About Metamatrix
          </h3>
          <div style="display: flex; justify-content: space-around; text-align: center; flex-wrap: wrap;">
            <div style="flex: 1; padding: 15px; min-width: 150px;">
              <div style="font-size: 32px; margin-bottom: 10px;">⚡</div>
              <div style="font-size: 14px; color: #666; font-weight: 600;">Lightning Fast</div>
              <div style="font-size: 12px; color: #888;">Bulk Updates</div>
            </div>
            <div style="flex: 1; padding: 15px; min-width: 150px;">
              <div style="font-size: 32px; margin-bottom: 10px;">🎯</div>
              <div style="font-size: 14px; color: #666; font-weight: 600;">Precision Control</div>
              <div style="font-size: 12px; color: #888;">Advanced Filters</div>
            </div>
            <div style="flex: 1; padding: 15px; min-width: 150px;">
              <div style="font-size: 32px; margin-bottom: 10px;">💝</div>
              <div style="font-size: 14px; color: #666; font-weight: 600;">Dedicated Support</div>
              <div style="font-size: 12px; color: #888;">Always Here</div>
            </div>
          </div>
        </div>

        <!-- Future Updates -->
        <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 35px;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🚀 Stay in Touch for Future Updates
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
            We're constantly improving Metamatrix based on merchant feedback. If you'd like to be notified when we release features that might interest you, feel free to stay subscribed to our updates.
          </p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="https://www.zenmeraki.com/contact" style="display: inline-block; background-color: #ffc107; color: #212529; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 14px;">
              📬 Stay Updated
            </a>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="background-color: #f8f9fa; padding: 25px 30px; border-top: 1px solid #eee;">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
          <img src="https://www.zenmeraki.com/assets/zenlogo-DQ0vQqSD.png" alt="ZenMeraki" style="width: 24px; height: 24px; margin-right: 10px; border-radius: 4px;">
          <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.5;">
            <strong>Thank you for giving us a try!</strong><br>
            The Metamatrix Team at <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none;">ZenMeraki</a>
          </p>
        </div>
        
        <!-- Contact Info -->
        <div style="margin-bottom: 15px;">
          <p style="color: #555; font-size: 14px; margin: 0 0 8px 0;">
            <strong>Need to reach us?</strong>
          </p>
          <p style="color: #555; font-size: 14px; margin: 0;">
            📧 <a href="mailto:zenmerakihelp@gmail.com" style="color: #4a90e2; text-decoration: none;">zenmerakihelp@gmail.com</a> | 
            🌐 <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none;">www.zenmeraki.com</a> | 
            📚 <a href="https://www.zenmeraki.com/contact" style="color: #4a90e2; text-decoration: none;">Support Center</a>
          </p>
        </div>

        <p style="color: #999; font-size: 12px; margin: 0; line-height: 1.4;">
          You received this email because you recently uninstalled Metamatrix from ${
            storeName || shopDomain
          }. 
          <a href="#unsubscribe" style="color: #4a90e2; text-decoration: none;">Unsubscribe from all emails</a>
        </p>
      </div>
    </div>
  </div>
`;
