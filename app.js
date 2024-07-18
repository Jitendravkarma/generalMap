import * as cheerio from "cheerio";
import puppeteerExtra from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import express from "express";
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
}));

app.get('/', (req, res) => {
  res.status(200).json({ message: "Ok" });
});

app.post("/google-map-extractor", (req, res) => {
  const query = req.query.query;

  if (!query) {
    return res.status(403).json({ message: "query should not be blank!" });
  }

  const searchGoogleMaps = async () => {
    try {
      const start = Date.now();

      puppeteerExtra.use(stealthPlugin());

      const browser = await puppeteerExtra.launch({
        headless: true, // Change this to true for better performance on serverless
      });

      const page = await browser.newPage();

      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['stylesheet', 'font', 'image', 'media', 'other'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(`https://www.google.com/maps/search/${query.split(" ").join("+")}`, {
        waitUntil: 'networkidle2', // Wait until the network is idle
      });

      await page.waitForSelector('div[role="feed"]');

      async function autoScroll(page) {
        await page.evaluate(async () => {
          const wrapper = document.querySelector('div[role="feed"]');

          await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 4000;
            var scrollDelay = 5000;

            var timer = setInterval(async () => {
              var scrollHeightBefore = wrapper.scrollHeight;
              wrapper.scrollBy(0, distance);
              totalHeight += distance;

              if (totalHeight >= scrollHeightBefore) {
                totalHeight = 0;
                await new Promise((resolve) =>
                  setTimeout(resolve, scrollDelay)
                );

                var scrollHeightAfter = wrapper.scrollHeight;

                if (scrollHeightAfter > scrollHeightBefore) {
                  return;
                } else {
                  clearInterval(timer);
                  resolve();
                }
              }
            }, 1000);
          });
        });
      }

      await autoScroll(page);

      const html = await page.content();
      await browser.close();

      const $ = cheerio.load(html);
      const aTags = $("a");
      const parents = [];
      aTags.each((i, el) => {
        const href = $(el).attr("href");
        if (href && href.includes("/maps/place/")) {
          parents.push($(el).parent());
        }
      });

      const data = [];
      parents.forEach((parent) => {
        const url = parent.find("a").attr("href");
        const website = parent.find('a[data-value="Website"]').attr("href");
        const title = parent.find("div.fontHeadlineSmall").text();
        const ratingText = parent.find("span.fontBodyMedium > span").attr("aria-label");

        const bodyDiv = parent.find("div.fontBodyMedium").first();
        const children = bodyDiv.children();
        const lastChild = children.last();
        const firstOfLast = lastChild.children().first();
        const lastOfLast = lastChild.children().last();

        data.push({
          address: firstOfLast?.text()?.split("·")?.[1]?.trim() || "",
          category: firstOfLast?.text()?.split("·")?.[0]?.trim() || "",
          phone: lastOfLast?.text()?.split("·")?.[1]?.trim() || "",
          mapUrl: url,
          website: website || "",
          title,
          ratingText,
          stars: ratingText?.split("stars")?.[0]?.trim() ? Number(ratingText?.split("stars")?.[0]?.trim()) : '',
          reviews: ratingText?.split("stars")?.[1]?.replace("Reviews", "")?.trim() ? Number(ratingText?.split("stars")?.[1]?.replace("Reviews", "")?.trim()) : '',
        });
      });

      const end = Date.now();
      console.log(`Time in seconds ${Math.floor((end - start) / 1000)}`);

      if (data.length) {
        res.status(200).json({ data });
      } else {
        res.status(204).json({ message: "No data found" });
      }
    } catch (error) {
      console.log("Error at googleMaps", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  searchGoogleMaps();
});

app.listen(2000, () => {
  console.log(`Server running on http://localhost:2000`);
});
