import BigNumber from 'bignumber.js'
import erc20 from 'config/abi/erc20.json'
// import masterchefABI from 'config/abi/masterchef.json'
import multicall from 'utils/multicall'
import { getMasterChefAddress } from 'utils/addressHelpers'
import farmsConfig from 'config/constants/farms'
import { getBalanceNumber } from 'utils/formatBalance';
import getMasterchefABI from 'utils/getMasterchefABI';
import { QuoteToken } from '../../config/constants/types'

const CHAIN_ID = process.env.REACT_APP_CHAIN_ID

const fetchFarms = async () => {
  const data = await Promise.all(
    farmsConfig.map(async (farmConfig) => {
      const lpAdress = farmConfig.lpAddresses[CHAIN_ID]
      const calls = [
        // Balance of token in the LP contract
        {
          address: farmConfig.tokenAddresses[CHAIN_ID],
          name: 'balanceOf',
          params: [lpAdress],
        },
        // Balance of quote token on LP contract
        {
          address: farmConfig.quoteTokenAddresses[CHAIN_ID],
          name: 'balanceOf',
          params: [lpAdress],
        },
        // Balance of LP tokens in the master chef contract
        {
          address: farmConfig.isTokenOnly ? farmConfig.tokenAddresses[CHAIN_ID] : lpAdress,
          name: 'balanceOf',
          params: [getMasterChefAddress(farmConfig.masterChefSymbol)],
        },
        // Total supply of LP tokens
        {
          address: lpAdress,
          name: 'totalSupply',
        },
        // Token decimals
        {
          address: farmConfig.tokenAddresses[CHAIN_ID],
          name: 'decimals',
        },
        // Quote token decimals
        {
          address: farmConfig.quoteTokenAddresses[CHAIN_ID],
          name: 'decimals',
        },
      ]
      
      const [
        tokenBalanceLP,
        quoteTokenBlanceLP,
        lpTokenBalanceMC,
        lpTotalSupply,
        tokenDecimals,
        quoteTokenDecimals
      ] = await multicall(erc20, calls)
      
      let tokenAmount;
      let lpTotalInQuoteToken;
      let tokenPriceVsQuote;
      if(farmConfig.isTokenOnly){
        tokenAmount = new BigNumber(lpTokenBalanceMC).div(new BigNumber(10).pow(tokenDecimals));
        if(farmConfig.tokenSymbol === QuoteToken.BUSD && farmConfig.quoteTokenSymbol === QuoteToken.BUSD){
          tokenPriceVsQuote = new BigNumber(1);
        }else{
          tokenPriceVsQuote = new BigNumber(quoteTokenBlanceLP).div(new BigNumber(tokenBalanceLP));
        }
        lpTotalInQuoteToken = tokenAmount.times(tokenPriceVsQuote);
      }else{
        // Ratio in % a LP tokens that are in staking, vs the total number in circulation
        const lpTokenRatio = new BigNumber(lpTokenBalanceMC).div(new BigNumber(lpTotalSupply))

        // Total value in staking in quote token value
        lpTotalInQuoteToken = new BigNumber(quoteTokenBlanceLP)
          .div(new BigNumber(10).pow(18))
          .times(new BigNumber(2))
          .times(lpTokenRatio)

        // Amount of token in the LP that are considered staking (i.e amount of token * lp ratio)
        tokenAmount = new BigNumber(tokenBalanceLP).div(new BigNumber(10).pow(tokenDecimals)).times(lpTokenRatio)
        const quoteTokenAmount = new BigNumber(quoteTokenBlanceLP)
          .div(new BigNumber(10).pow(quoteTokenDecimals))
          .times(lpTokenRatio)

        if(tokenAmount.comparedTo(0) > 0){
          tokenPriceVsQuote = quoteTokenAmount.div(tokenAmount);
        }else{
          tokenPriceVsQuote = new BigNumber(quoteTokenBlanceLP).div(new BigNumber(tokenBalanceLP));
        }
      }
      
      const masterchefABI = getMasterchefABI(farmConfig.masterChefSymbol);
      const [info, totalAllocPoint, tokenPerBlock] = await multicall(masterchefABI, [
        {
          address: getMasterChefAddress(farmConfig.masterChefSymbol),
          name: 'poolInfo',
          params: [farmConfig.pid],
        },
        {
          address: getMasterChefAddress(farmConfig.masterChefSymbol),
          name: 'totalAllocPoint',
        },
        {
          address: getMasterChefAddress(farmConfig.masterChefSymbol),
          name: farmConfig.masterChefSymbol === 'PLOCK' ? 'plockPerBlock' : 'tbakePerBlock',
        },
      ])

      const allocPoint = new BigNumber(info.allocPoint._hex)
      const poolWeight = allocPoint.div(new BigNumber(totalAllocPoint))

      return {
        ...farmConfig,
        tokenAmount: tokenAmount.toJSON(),
        // quoteTokenAmount: quoteTokenAmount,
        lpTotalInQuoteToken: lpTotalInQuoteToken.toJSON(),
        tokenPriceVsQuote: tokenPriceVsQuote.toJSON(),
        poolWeight: poolWeight.toNumber(),
        multiplier: `${allocPoint.div(100).toString()}X`,
        depositFeeBP: info.depositFeeBP,
        tokenPerBlock: new BigNumber(tokenPerBlock).toNumber(),
        tokenBalanceLP: new BigNumber(tokenBalanceLP).div(new BigNumber(10).pow(tokenDecimals)),
        quoteTokenBalanceLP: new BigNumber(quoteTokenBlanceLP).div(new BigNumber(10).pow(tokenDecimals)),
        lpTotalSupply: getBalanceNumber(new BigNumber(lpTotalSupply))
      }
    }),
  )
  return data
}

export default fetchFarms
