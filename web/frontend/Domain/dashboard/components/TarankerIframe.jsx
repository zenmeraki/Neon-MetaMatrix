import React, { useEffect } from "react";
import { Card, Box, InlineStack } from "@shopify/polaris";

const TarankerIframe = () => {
  useEffect(() => {
    const handleMessage = (event) => {
      const { origin, data } = event;
      if (
        origin === "https://widget.taranker.com" &&
        data?.type === "TARANKER_CO_PARTNER" &&
        data?.iframeHeight
      ) {
        const iframe = document.getElementById("taranker-co-partner-iframe");
        if (iframe) {
          const reservedHeight = Math.max(Number(data.iframeHeight) || 0, 420);
          iframe.style.height = `${reservedHeight}px`;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <Box
      background="bg-surface"
      paddingBlockStart="200"
      paddingInlineStart="100"
      paddingInlineEnd="100"
      width="100%"
    >
      <Card>
        <InlineStack align="center" blockAlign="center">
          <Box width="95%">
            <div className="embedded-widget-frame">
            <iframe
              id="taranker-co-partner-iframe"
              src="https://widget.taranker.com/partner/6101903146e4bbf4999c449d78441606?shop=Https://demo-zen-store.myshopify.com&3044670=&limit=3"
              frameBorder="0"
              width="100%"
              height="420"
              scrolling="no"
              title="Taranker Co Partner"
              style={{
                display: "block",
                margin: "auto",
                backgroundColor: "white",
              }}
            />
            </div>
          </Box>
        </InlineStack>
      </Card>
    </Box>
  );
};

export default TarankerIframe;
