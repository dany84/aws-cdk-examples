#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PrivateVpcWithTgwStack } from '../lib/private-vpc-with-tgw-stack';

const app = new cdk.App();
new PrivateVpcWithTgwStack(app, 'PrivateVpcWithTgwStack');
