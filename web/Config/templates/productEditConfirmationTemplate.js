export const productEditConfirmationEmailHTML = (shopOwner, shop, history) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8f9fa; padding: 20px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%); color: white; padding: 25px 30px; text-align: center;">
        <div style="margin-bottom: 10px;">
          <img src="https://cdn.shopify.com/app-store/listing_images/0d2faed5eadc2b3043d4da7d9dc6e290/icon/CL_ziN7d8YkDEAE=.png" alt="ZenMeraki Logo" style="width: 40px; height: 40px; border-radius: 6px; vertical-align: middle;">
        </div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">
          ✅ Product Edit Confirmed
        </h1>
        <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">
          Your changes have been successfully applied
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 35px 30px;">
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
          Hi ${shopOwner || "there"}, 👋
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          Great news! Your product edits have been successfully completed through Metamatrix.
        </p>

        <!-- Product Details Card -->
        <div style="background-color: #f8f9fa; border-left: 4px solid #28a745; border-radius: 8px; padding: 20px; margin: 25px 0;">
          <h3 style="color: #333; margin: 0 0 12px 0; font-size: 18px; font-weight: 600; display: flex; align-items: center;">
            <span style="margin-right: 8px;">📦</span> Edited Product
          </h3>
          <p style="color: #555; font-size: 16px; margin: 0; font-weight: 500;">
            ${history?.title || "N/A"}
          </p>
        </div>

        <!-- Action Section -->
        <div style="background-color: #e8f4fd; border-radius: 8px; padding: 25px; margin: 30px 0; text-align: center;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">
            🎯 What's Next?
          </h3>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
            Review your changes and see them live on your store
          </p>
          <a href="https://${shop}/admin/products" target="_blank" style="display: inline-block; background-color: #4a90e2; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: 600; font-size: 15px; margin-right: 10px;">
            📊 View in Shopify Admin
          </a>
        </div>

        <!-- Support Info -->
        <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 30px;">
          <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
            <div style="background-color: #fff3cd; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px; flex-shrink: 0;">
              <span style="font-size: 18px;">💬</span>
            </div>
            <div>
              <h4 style="color: #333; margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">
                Need Help?
              </h4>
              <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0;">
                If you didn't make these edits or need assistance, our support team is here to help.
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
          Thanks for using Metamatrix! We're excited to help you manage your products more efficiently.
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
          This confirmation was sent because you made product edits through Metamatrix. 
          <a href="#" style="color: #4a90e2; text-decoration: none;">Manage email preferences</a>
        </p>
      </div>
    </div>
  </div>
`;
