export const productExportCompletionEmailHTML = (shopOwner, filename, shop) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8f9fa; padding: 20px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #28a745 0%, #1e7e34 100%); color: white; padding: 25px 30px; text-align: center;">
        <div style="margin-bottom: 10px;">
          <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="ZenMeraki Logo" style="width: 40px; height: 40px; border-radius: 6px; vertical-align: middle;">
        </div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">
          📥 Export Complete
        </h1>
        <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">
          Your product export is ready for download
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 35px 30px;">
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
          Hi ${shopOwner || "there"}, 👋
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          Great news! Your product export has been successfully completed and is ready for download.
        </p>

        <!-- Export Details Card -->
        <div style="background-color: #d4edda; border-left: 4px solid #28a745; border-radius: 8px; padding: 20px; margin: 25px 0;">
          <h3 style="color: #333; margin: 0 0 12px 0; font-size: 18px; font-weight: 600; display: flex; align-items: center;">
            <span style="margin-right: 8px;">📊</span> Export Details
          </h3>
          <p style="color: #555; font-size: 16px; margin: 0; font-weight: 500;">
            <strong>File:</strong> ${filename || "export.csv"}
          </p>
        </div>

        <!-- Action Section -->
        <div style="background-color: #e8f4fd; border-radius: 8px; padding: 25px; margin: 30px 0; text-align: center;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🎯 Ready to Download
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
            Access your exported file from the Metamatrix dashboard
          </p>
          <a href="https://admin.shopify.com/store/${
            shop?.replace(".myshopify.com", "") || "your-store"
          }/apps/metamatrix" target="_blank" style="display: inline-block; background-color: #28a745; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 15px; margin-right: 10px;">
            📱 Open Metamatrix Dashboard
          </a>
        </div>

        <!-- Info Section -->
        <div style="background-color: #fff3cd; border-radius: 8px; padding: 20px; margin: 25px 0;">
          <div style="display: flex; align-items: flex-start;">
            <div style="background-color: #ffc107; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; margin-right: 15px; flex-shrink: 0;">
              <span style="font-size: 16px; color: white;">💡</span>
            </div>
            <div>
              <h4 style="color: #333; margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">
                Quick Tip
              </h4>
              <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0;">
                Your exported file contains all the product data you selected. You can use it for backup, analysis, or importing to other platforms.
              </p>
            </div>
          </div>
        </div>

        <!-- Support Info -->
        <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 30px;">
          <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
            <div style="background-color: #e8f4fd; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px; flex-shrink: 0;">
              <span style="font-size: 18px;">💬</span>
            </div>
            <div>
              <h4 style="color: #333; margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">
                Need Help?
              </h4>
              <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0;">
                If you didn't request this export or have any questions about your data, our support team is here to help.
              </p>
            </div>
          </div>
          
          <div style="background-color: #f8f9fa; border-radius: 6px; padding: 15px; margin-top: 15px;">
            <p style="color: #555; font-size: 15px; margin: 0; text-align: center;">
              📧 <a href="mailto:zenmerakihelp@gmail.com" style="color: #4a90e2; text-decoration: none; font-weight: 500;">zenmerakihelp@gmail.com</a> | 
              🌐 <a href="https://www.zenmeraki.com" style="color: #4a90e2; text-decoration: none; font-weight: 500;">www.zenmeraki.com</a>
            </p>
          </div>
        </div>

        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 30px 0 0 0;">
          Thanks for using Metamatrix! We're here to make your product management as efficient as possible.
        </p>
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
          This notification was sent because you requested a product export through Metamatrix. 
          <a href="#" style="color: #4a90e2; text-decoration: none;">Manage email preferences</a>
        </p>
      </div>
    </div>
  </div>
`;
