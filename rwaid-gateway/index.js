
require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");

const PORT = process.env.PORT || 5000;

// Required env vars (trim whitespace)
const LINEA_RPC_URL = (process.env.LINEA_RPC_URL || '').trim();
const REGISTRY = (process.env.RWA_ID_REGISTRY || '').trim();

if (!LINEA_RPC_URL) throw new Error("Missing LINEA_RPC_URL");
if (!REGISTRY) throw new Error("Missing RWA_ID_REGISTRY");

const provider = new ethers.JsonRpcProvider(LINEA_RPC_URL);
const GATEWAY_SIGNER_PRIVATE_KEY = (process.env.GATEWAY_SIGNER_PRIVATE_KEY || '').trim();
if (!GATEWAY_SIGNER_PRIVATE_KEY) throw new Error("Missing GATEWAY_SIGNER_PRIVATE_KEY");

const signer = new ethers.Wallet(GATEWAY_SIGNER_PRIVATE_KEY);
const SIGNER_ADDRESS = signer.address;
console.log("GATEWAY SIGNER ADDRESS:", SIGNER_ADDRESS);

const REGISTRY_ABI = [
  "function projectIdBySlugHash(bytes32) view returns (uint256)",
  "function nameNodeFromHash(uint256,bytes32) view returns (bytes32)",
  "function nodeAddr(bytes32) view returns (address)",
];

const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

// labelhash = keccak256(bytes(label)) with lowercase policy
function labelhash(s) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(s).trim().toLowerCase()));
}

function parseName(name) {
  const n = String(name).trim().toLowerCase();
  // expecting: <label>.<slug>.rwa-id.eth
  const parts = n.split(".");
  if (parts.length < 4) throw new Error("Invalid name: must be label.slug.rwa-id.eth");
  const label = parts[0];
  const slug = parts[1];
  const suffix = parts.slice(2).join(".");
  if (suffix !== "rwa-id.eth") throw new Error("Invalid suffix: must end with rwa-id.eth");
  if (!label || !slug) throw new Error("Invalid label/slug");
  return { label, slug };
}

const app = express();

app.get("/health", async (_req, res) => {
  try {
    const network = await provider.getNetwork();
    res.json({
      ok: true,
      chainId: network.chainId.toString(),
      rpc: LINEA_RPC_URL,
      registry: REGISTRY,
      signer: SIGNER_ADDRESS
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// MVP read endpoint (no signing yet)
app.get("/resolve", async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "Missing ?name=" });

    const { label, slug } = parseName(name);

    const slugHash = labelhash(slug);
    const nameHash = labelhash(label);

    const projectId = await registry.projectIdBySlugHash(slugHash);
    if (projectId === 0n) return res.status(404).json({ error: "Unknown slug/project", slug });

    const node = await registry.nameNodeFromHash(projectId, nameHash);
    const addr = await registry.nodeAddr(node);

    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "address"],
      [REGISTRY, node, addr]
    );

    const signature = signer.signingKey.sign(messageHash).serialized;

    res.json({
      name: `${label}.${slug}.rwa-id.eth`,
      projectId: projectId.toString(),
      nameHash,
      node,
      address: addr,
      messageHash,
      signature,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});


// CCIP-Read endpoint: returns ABI-encoded bytes for resolver callback
// Query: ?name=hector.securitize.rwa-id.eth
app.get("/ccip", async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).send("Missing ?name=");

    const { label, slug } = parseName(name);
    const slugHash = labelhash(slug);
    const nameHash = labelhash(label);

    const projectId = await registry.projectIdBySlugHash(slugHash);
    if (projectId === 0n) return res.status(404).send("Unknown slug/project");

    const node = await registry.nameNodeFromHash(projectId, nameHash);
    const addr = await registry.nodeAddr(node);

    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "address"],
      [REGISTRY, node, addr]
    );

    const signature = signer.signingKey.sign(messageHash).serialized;

    // ABI encode (bytes32 node, address resolved, bytes32 messageHash, bytes signature)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "bytes32", "bytes"],
      [node, addr, messageHash, signature]
    );

    res.setHeader("Content-Type", "text/plain");
    res.send(encoded);
  } catch (e) {
    res.status(500).send(e.message || String(e));
  }
});


// EIP-3668 standard endpoint: /{sender}/{data}.json
// where {data} is hex(callData) from OffchainLookup
// callData = abi.encode(nameBytes, dataBytes)
function dnsBytesToName(nameBytesHex) {
  const bytes = ethers.getBytes(nameBytesHex);
  let i = 0;
  const labels = [];
  while (i < bytes.length) {
    const len = bytes[i];
    i += 1;
    if (len === 0) break;
    const labelBytes = bytes.slice(i, i + len);
    labels.push(Buffer.from(labelBytes).toString("utf8"));
    i += len;
  }
  return labels.join(".");
}

app.get("/:sender/:data.json", async (req, res) => {
  try {
    const dataHex = req.params.data;
    if (!dataHex || !dataHex.startsWith("0x")) {
      return res.status(400).send("data must be 0x...");
    }

    // Decode callData = abi.encode(bytes name, bytes data)
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["bytes", "bytes"],
      dataHex
    );

    const nameBytes = decoded[0]; // 0x...
    const fullName = dnsBytesToName(nameBytes).toLowerCase(); // e.g. hector.securitize.rwa-id.eth

    // We only support label.slug.rwa-id.eth
    const { label, slug } = parseName(fullName);

    const slugHash = labelhash(slug);
    const nameHash = labelhash(label);

    const projectId = await registry.projectIdBySlugHash(slugHash);
    if (projectId === 0n) return res.status(404).send("Unknown slug/project");

    const node = await registry.nameNodeFromHash(projectId, nameHash);
    const addr = await registry.nodeAddr(node);

    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "address"],
      [REGISTRY, node, addr]
    );

    const signature = signer.signingKey.sign(messageHash).serialized;

    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "bytes32", "bytes"],
      [node, addr, messageHash, signature]
    );

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    // ENS clients accept JSON: { data: "0x..." }
    res.send(JSON.stringify({ data: encoded, signer: SIGNER_ADDRESS }));
  } catch (e) {
    res.status(500).send(e.message || String(e));
  }
});

app.listen(PORT, () => {
  console.log(`rwaid-gateway listening on :${PORT}`);
  console.log("LINEA_RPC_URL:", LINEA_RPC_URL);
  console.log("RWA_ID_REGISTRY:", REGISTRY);
});
