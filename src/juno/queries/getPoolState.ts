import { BotClients } from "../../node/chainoperator";
import {
	Asset,
	isJunoSwapNativeAssetInfo,
	isWyndDaoNativeAsset,
	isWyndDaoTokenAsset,
	JunoSwapAssetInfo,
} from "../../types/core/asset";
import { AmmDexName, Pool } from "../../types/core/pool";
import { Uint128 } from "../../types/core/uint128";
import { getPoolsFromFactory } from "./getPoolsFromFactory";

interface JunoSwapPoolState {
	token1_reserve: string;
	token1_denom: JunoSwapAssetInfo;
	token2_reserve: string;
	token2_denom: JunoSwapAssetInfo;
	lp_token_supply: string;
	lp_token_address: string;
}

interface PoolState {
	assets: [Asset, Asset];
	total_share: Uint128;
}

/**
 * Retrieves the pool state of a given Terra address.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param pools An array of Pool objects to obtain the chain states for.
 */
export async function getPoolStates(botClients: BotClients, pools: Array<Pool>) {
	await Promise.all(
		pools.map(async (pool) => {
			if (pool.dexname === AmmDexName.junoswap) {
				const poolState: JunoSwapPoolState = await botClients.WasmQueryClient.wasm.queryContractSmart(
					pool.address,
					{ info: {} },
				);
				pool.assets[0].amount = poolState.token1_reserve;
				pool.assets[1].amount = poolState.token2_reserve;
				return;
			} else {
				const poolState: PoolState = await botClients.WasmQueryClient.wasm.queryContractSmart(pool.address, {
					pool: {},
				});
				const [assets] = processPoolStateAssets(poolState);
				pool.assets = assets;
			}
		}),
	);
}

/**
 * Initializes the pools based on a queryclient with wasmextension.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param poolAddresses An array of objects (set by environment variables) holding the pooladdress, its inputfee and its outputfee.
 * @param factoryMapping An array of objects (set by environment variables) holding the mapping between factories and their routers.
 * @returns An array of instantiated Pool objects.
 */
export async function initPools(
	botClients: BotClients,
	poolAddresses: Array<{ pool: string; inputfee: number; outputfee: number }>,
	factoryMapping: Array<{ factory: string; router: string }>,
): Promise<Array<Pool>> {
	const pools: Array<Pool> = [];
	const factoryPools = await getPoolsFromFactory(botClients, factoryMapping);
	for (const poolAddress of poolAddresses) {
		let assets: Array<Asset> = [];
		let dexname: AmmDexName;
		let totalShare: string;
		try {
			const poolState = <PoolState>(
				await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress.pool, { pool: {} })
			);
			[assets, dexname, totalShare] = processPoolStateAssets(poolState);
		} catch (error) {
			const poolState = <JunoSwapPoolState>(
				await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress.pool, { info: {} })
			);
			[assets, dexname, totalShare] = processJunoswapPoolStateAssets(poolState);
		}
		const factory = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.factory ?? "";
		const router = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.router ?? "";

		pools.push({
			assets: assets,
			totalShare: totalShare,
			address: poolAddress.pool,
			dexname: dexname,
			inputfee: poolAddress.inputfee,
			outputfee: poolAddress.outputfee,
			factoryAddress: factory,
			routerAddress: router,
		});
	}
	return pools;
}

/**
 *
 */
function processPoolStateAssets(poolState: PoolState): [Array<Asset>, AmmDexName, string] {
	const assets: Array<Asset> = [];
	let type = AmmDexName.default;

	for (const assetState of poolState.assets) {
		if (isWyndDaoNativeAsset(assetState.info)) {
			assets.push({
				amount: assetState.amount,
				info: { native_token: { denom: assetState.info.native } },
			});
			type = AmmDexName.wyndex;
		} else if (isWyndDaoTokenAsset(assetState.info)) {
			assets.push({
				amount: assetState.amount,
				info: { token: { contract_addr: assetState.info.token } },
			});
			type = AmmDexName.wyndex;
		} else {
			assets.push(assetState);
		}
	}
	return [assets, type, poolState.total_share];
}

/**
 *
 */
function processJunoswapPoolStateAssets(poolState: JunoSwapPoolState): [Array<Asset>, AmmDexName, string] {
	const assets: Array<Asset> = [];
	assets.push({
		amount: String(poolState.token1_reserve),
		info: isJunoSwapNativeAssetInfo(poolState.token1_denom)
			? { native_token: { denom: poolState.token1_denom.native } }
			: { token: { contract_addr: poolState.token1_denom.cw20 } },
	});

	assets.push({
		amount: String(poolState.token2_reserve),
		info: isJunoSwapNativeAssetInfo(poolState.token2_denom)
			? { native_token: { denom: poolState.token2_denom.native } }
			: { token: { contract_addr: poolState.token2_denom.cw20 } },
	});

	return [assets, AmmDexName.junoswap, poolState.lp_token_supply];
}
