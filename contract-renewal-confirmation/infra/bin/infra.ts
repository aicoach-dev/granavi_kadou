#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ContractRenewalStack } from '../lib/infra-stack';

const app = new cdk.App();

const stack = new ContractRenewalStack(app, 'ContractRenewalStack', {
  env: {
    account: '698212246219',
    region: 'ap-northeast-1',
  },
  description: '契約更新 本人意思確認システム 基盤スタック',
});

cdk.Tags.of(stack).add('Project', 'contract-renewal');
cdk.Tags.of(stack).add('ManagedBy', 'cdk');
