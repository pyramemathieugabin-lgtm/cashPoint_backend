const MVOLA_WITHDRAWAL_OPERATOR_FEES = [
  { minAmount: 100, maxAmount: 1000, operatorFee: 100 },
  { minAmount: 1001, maxAmount: 5000, operatorFee: 150 },
  { minAmount: 5001, maxAmount: 10000, operatorFee: 275 },
  { minAmount: 10001, maxAmount: 20000, operatorFee: 550 },
  { minAmount: 20001, maxAmount: 25000, operatorFee: 650 },
  { minAmount: 25001, maxAmount: 50000, operatorFee: 1300 },
  { minAmount: 50001, maxAmount: 100000, operatorFee: 1900 },
  { minAmount: 100001, maxAmount: 250000, operatorFee: 3400 },
  { minAmount: 250001, maxAmount: 500000, operatorFee: 4700 },
  { minAmount: 500001, maxAmount: 1000000, operatorFee: 8800 },
  { minAmount: 1000001, maxAmount: 2000000, operatorFee: 14700 },
  { minAmount: 2000001, maxAmount: 3000000, operatorFee: 19600 },
  { minAmount: 3000001, maxAmount: 4000000, operatorFee: 24500 },
  { minAmount: 4000001, maxAmount: 5000000, operatorFee: 29400 },
  { minAmount: 5000001, maxAmount: 6000000, operatorFee: 34300 },
  { minAmount: 6000001, maxAmount: 7000000, operatorFee: 39200 },
  { minAmount: 7000001, maxAmount: 8000000, operatorFee: 44100 },
  { minAmount: 8000001, maxAmount: 9000000, operatorFee: 49000 },
  { minAmount: 9000001, maxAmount: 10000000, operatorFee: 53900 },
  { minAmount: 10000001, maxAmount: 11000000, operatorFee: 59000 },
  { minAmount: 11000001, maxAmount: 12000000, operatorFee: 64000 },
  { minAmount: 12000001, maxAmount: 13000000, operatorFee: 69000 },
  { minAmount: 13000001, maxAmount: 14000000, operatorFee: 74000 },
  { minAmount: 14000001, maxAmount: 15000000, operatorFee: 79000 },
  { minAmount: 15000001, maxAmount: 16000000, operatorFee: 84000 },
  { minAmount: 16000001, maxAmount: 17000000, operatorFee: 89000 },
  { minAmount: 17000001, maxAmount: 18000000, operatorFee: 94000 },
  { minAmount: 18000001, maxAmount: 19000000, operatorFee: 98000 },
  { minAmount: 19000001, maxAmount: 20000000, operatorFee: 100000 },
];

const isMvolaWithdrawalTariff = (operator, operationType) => operator === "YAS" && operationType === "RETRAIT";

const findMvolaWithdrawalOperatorFee = (minAmount, maxAmount) =>
  MVOLA_WITHDRAWAL_OPERATOR_FEES.find((fee) => fee.minAmount === Number(minAmount) && fee.maxAmount === Number(maxAmount)) || null;

module.exports = {
  MVOLA_WITHDRAWAL_OPERATOR_FEES,
  isMvolaWithdrawalTariff,
  findMvolaWithdrawalOperatorFee,
};
