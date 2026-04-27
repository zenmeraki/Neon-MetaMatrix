export const welcomeEmailHTML = (userName, shop) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8f9fa; padding: 20px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <!-- Header -->
      <div style="background-color: #4a90e2; color: white; padding: 30px; text-align: center;">
        <div style="margin-bottom: 15px;">
          <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="ZenMeraki Logo" style="width: 48px; height: 48px; border-radius: 8px; vertical-align: middle;">
        </div>
        <h1 style="margin: 0; font-size: 28px; font-weight: 600;">
          Welcome to Metamatrix
        </h1>
        <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">
          Hello ${userName || "there"}! 👋
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 40px 30px;">
        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">
          🚀 Ready to supercharge your Shopify store?
        </h2>
        
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          Thanks for installing Metamatrix! You now have the power to bulk update your Shopify products with ease. Say goodbye to tedious one-by-one product editing.
        </p>

        <!-- Key Features -->
        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">
            ⚡ What you can do with Metamatrix:
          </h3>
          <ul style="color: #555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li><strong>📦 Bulk Product Updates:</strong> Edit hundreds of products simultaneously</li>
            <li><strong>💰 Price Management:</strong> Update pricing across your entire catalog</li>
            <li><strong>🏷️ Inventory Control:</strong> Manage stock levels efficiently</li>
            <li><strong>📝 Product Information:</strong> Update descriptions, tags, and metadata</li>
            <li><strong>⏱️ Time-Saving Automation:</strong> Complete hours of work in minutes</li>
          </ul>
        </div>

        <!-- Getting Started -->
        <div style="background-color: #e8f4fd; border-left: 4px solid #4a90e2; padding: 20px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🎯 Getting Started is Easy:
          </h3>
          <ol style="color: #555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li>Open Metamatrix from your Shopify admin</li>
            <li>Select the products you want to update</li>
            <li>Choose your update criteria</li>
            <li>Apply changes with one click!</li>
          </ol>
        </div>

        <!-- Call to Action -->
        <div style="text-align: center; margin: 35px 0;">
          <a href="https://admin.shopify.com/store/${shop}/apps/metamatrix" style="display: inline-block; background-color: #4a90e2; color: white; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
            🚀 Launch Metamatrix
          </a>
          <p style="color: #777; font-size: 14px; margin: 15px 0 0 0;">
            Access directly from your Shopify admin panel
          </p>
        </div>

        <!-- Support -->
        <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 35px;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            💬 Need Help?
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
            Our support team is here to help you get the most out of Metamatrix. Whether you have questions about bulk updates or need assistance with specific features, we've got you covered.
          </p>
          <p style="color: #555; font-size: 15px; margin: 0;">
            📧 <a href="mailto:zenmerakihelp@gmail.com" style="color: #4a90e2; text-decoration: none;">zenmerakihelp@gmail.com</a> | 
            🌐 <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none;">www.zenmeraki.com</a> | 
            📚 <a href="https://www.zenmeraki.com/contact" style="color: #4a90e2; text-decoration: none;">Help Center</a>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="background-color: #f8f9fa; padding: 25px 30px; border-top: 1px solid #eee;">
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <img src="https://www.zenmeraki.com/assets/zenlogo-DQ0vQqSD.png" alt="ZenMeraki" style="width: 24px; height: 24px; margin-right: 10px; border-radius: 4px;">
          <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.5;">
            <strong>Best regards,</strong><br>
            The Metamatrix Team at <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none;">ZenMeraki</a>
          </p>
        </div>
        <p style="color: #999; font-size: 12px; margin: 0; line-height: 1.4;">
          You're receiving this email because you installed Metamatrix on your Shopify store. 
          <a href="#" style="color: #4a90e2; text-decoration: none;">Manage email preferences</a>
        </p>
      </div>
    </div>
  </div>
`;

export const adminInstallNotificationHTML = (
  shopDomain,
  storeEmail,
  storeName,
  installDate
) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8f9fa; padding: 20px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
        <div style="margin-bottom: 15px;">
          <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="ZenMeraki Logo" style="width: 48px; height: 48px; border-radius: 8px; vertical-align: middle;">
        </div>
        <h1 style="margin: 0; font-size: 28px; font-weight: 600;">
          🎉 New Metamatrix Installation
        </h1>
        <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">
          A new store has joined the family!
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 40px 30px;">
        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">
          🏪 Store Installation Details
        </h2>
        
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          Great news! A new Shopify store has successfully installed Metamatrix. Here are the details:
        </p>

        <!-- Store Information -->
        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 18px; font-weight: 600;">
            📊 Store Information:
          </h3>
          <div style="color: #555; font-size: 15px; line-height: 1.8;">
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef;">
              <strong>Store Name:</strong>
              <span>${storeName || shopDomain}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef;">
              <strong>Shop Domain:</strong>
              <span>${shopDomain}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef;">
              <strong>Store Email:</strong>
              <span>${storeEmail}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
              <strong>Installation Date:</strong>
              <span>${installDate || new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div style="background-color: #e8f4fd; border-left: 4px solid #4a90e2; padding: 20px; margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            ⚡ Quick Actions:
          </h3>
          <ul style="color: #555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li>Monitor store onboarding progress</li>
            <li>Send personalized welcome resources if needed</li>
            <li>Check for any integration issues</li>
            <li>Add to customer success follow-up list</li>
          </ul>
        </div>

      <!-- Call to Actions -->
<div style="text-align: center; margin: 35px 0;">
  <div style="display: inline-block; margin: 10px;">
    <a 
      href="mailto:${storeEmail}" 
      style="display: inline-block; background-color: #28a745; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 14px;">
      📧 Contact Store
    </a>
  </div>
</div>


        <!-- Stats Summary -->
        <div style="border: 1px solid #e9ecef; border-radius: 8px; padding: 25px; margin: 30px 0; background-color: #fff;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; text-align: center;">
            📈 Installation Summary
          </h3>
          <div style="display: flex; justify-content: space-around; text-align: center;">
            <div style="flex: 1; padding: 0 15px;">
              <div style="font-size: 24px; font-weight: 700; color: #4a90e2; margin-bottom: 5px;">
                +1
              </div>
              <div style="font-size: 14px; color: #666;">
                New Install
              </div>
            </div>
            <div style="flex: 1; padding: 0 15px; border-left: 1px solid #e9ecef; border-right: 1px solid #e9ecef;">
              <div style="font-size: 24px; font-weight: 700; color: #28a745; margin-bottom: 5px;">
                🎯
              </div>
              <div style="font-size: 14px; color: #666;">
                Ready to Use
              </div>
            </div>
            <div style="flex: 1; padding: 0 15px;">
              <div style="font-size: 24px; font-weight: 700; color: #ffc107; margin-bottom: 5px;">
                📊
              </div>
              <div style="font-size: 14px; color: #666;">
                Track Progress
              </div>
            </div>
          </div>
        </div>

        <!-- Next Steps -->
        <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 35px;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🎯 Recommended Next Steps:
          </h3>
          <ol style="color: #555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li>Send a personalized welcome email to the store owner</li>
            <li>Monitor app usage during the first 48 hours</li>
            <li>Schedule a follow-up check after 1 week</li>
            <li>Add to onboarding email sequence if configured</li>
          </ol>
        </div>
      </div>

      <!-- Footer -->
      <div style="background-color: #f8f9fa; padding: 25px 30px; border-top: 1px solid #eee;">
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <img src="https://www.zenmeraki.com/assets/zenlogo-DQ0vQqSD.png" alt="ZenMeraki" style="width: 24px; height: 24px; margin-right: 10px; border-radius: 4px;">
          <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.5;">
            <strong>Metamatrix Admin Notification</strong><br>
            Powered by <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none;">ZenMeraki</a>
          </p>
        </div>
        <p style="color: #999; font-size: 12px; margin: 0; line-height: 1.4;">
          This is an automated notification for new app installations. 
          Generated on ${new Date().toLocaleString()}
        </p>
      </div>
    </div>
  </div>
`;
