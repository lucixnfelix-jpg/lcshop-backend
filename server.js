require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const Iyzipay = require("iyzipay");

const app = express();
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

const NETLIFY_SITE_URL = process.env.NETLIFY_SITE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

// Root + health (test için)
app.get("/", (req, res) => res.send("LC Shop backend OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// IYZICO safe init (env yoksa çökmesin)
let iyzipay = null;
if (process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY && process.env.IYZICO_URI) {
  iyzipay = new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_URI
  });
} else {
  console.log("IYZICO env missing: checkout endpoints disabled until set.");
}

/* GOOGLE LOGIN */
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const email = req.user?.emails?.[0]?.value || "";
    const name = req.user?.displayName || (email ? email.split("@")[0] : "LC Üye");
    const token = jwt.sign({ email, name }, JWT_SECRET, { expiresIn: "7d" });
    res.redirect(`${NETLIFY_SITE_URL}/panel.html?token=${encodeURIComponent(token)}`);
  }
);

/* AUTH */
function requireAuth(req, res, next){
  try{
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if(!token) return res.status(401).json({ error: "unauthorized" });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch{
    return res.status(401).json({ error: "unauthorized" });
  }
}

/* IYZICO CHECKOUT INIT */
app.post("/api/iyzico/checkout-init", requireAuth, (req, res) => {
  if(!iyzipay) return res.status(503).json({ error: "iyzico_not_configured" });

  const priceMap = { week: "99.00", month: "139.00", quarter: "269.00" };
  const plan = req.body?.plan || "month";
  const price = priceMap[plan] || "139.00";

  const request = {
    locale: "tr",
    conversationId: "LC-" + Date.now(),
    price,
    paidPrice: price,
    currency: "TRY",
    basketId: "B" + Date.now(),
    paymentGroup: "PRODUCT",
    callbackUrl: `${process.env.PUBLIC_BASE_URL}/api/iyzico/callback`,
    buyer: {
      id: "U" + Date.now(),
      name: req.user.name || "LC",
      surname: "User",
      email: req.user.email || "user@example.com",
      identityNumber: "11111111111",
      registrationAddress: "Digital",
      ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0] || req.socket.remoteAddress,
      city: "Istanbul",
      country: "Turkey"
    },
    shippingAddress: {
      contactName: req.user.name || "LC User",
      city: "Istanbul",
      country: "Turkey",
      address: "Digital Delivery"
    },
    billingAddress: {
      contactName: req.user.name || "LC User",
      city: "Istanbul",
      country: "Turkey",
      address: "Digital Delivery"
    },
    basketItems: [{
      id: "P-" + plan,
      name: `Discord Boost - ${plan}`,
      category1: "Digital",
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
      price
    }]
  };

  Iyzipay.CheckoutFormInitialize.create(request, iyzipay, (err, result) => {
    if(err || result?.status !== "success"){
      return res.status(400).json({ error: result?.errorMessage || "iyzico_error" });
    }
    res.json({ checkoutFormContent: result.checkoutFormContent });
  });
});

/* IYZICO CALLBACK */
app.post("/api/iyzico/callback", express.urlencoded({ extended: true }), (req, res) => {
  if(!iyzipay) return res.redirect(`${NETLIFY_SITE_URL}/fail.html`);

  const token = req.body?.token;
  if(!token) return res.redirect(`${NETLIFY_SITE_URL}/fail.html`);

  Iyzipay.CheckoutForm.retrieve({ locale: "tr", token }, iyzipay, (err, result) => {
    if(result?.status === "success" && (result?.paymentStatus === "SUCCESS" || result?.paymentStatus === "success")){
      return res.redirect(`${NETLIFY_SITE_URL}/success.html`);
    }
    return res.redirect(`${NETLIFY_SITE_URL}/fail.html`);
  });
});

app.listen(process.env.PORT || 3000, () => console.log("Backend running"));
