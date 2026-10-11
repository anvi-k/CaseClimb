#!/bin/bash
# Stands up the Rounds server. Requires the AWS CLI with credentials that can create IAM roles,
# EC2 instances and CloudFront distributions. Set VPC, SUBNET and AMI (Amazon Linux 2023) first.
set -euo pipefail
: "${VPC:?}" "${SUBNET:?}" "${AMI:?}"

aws iam create-role --role-name rounds-app-role --assume-role-policy-document file://ec2-trust-policy.json
for p in AmazonBedrockFullAccess AmazonSSMManagedInstanceCore AmazonPollyFullAccess; do
  aws iam attach-role-policy --role-name rounds-app-role --policy-arn "arn:aws:iam::aws:policy/$p"
done
aws iam create-instance-profile --instance-profile-name rounds-app-profile
aws iam add-role-to-instance-profile --instance-profile-name rounds-app-profile --role-name rounds-app-role

aws ec2 create-key-pair --key-name rounds-key --query KeyMaterial --output text > rounds-key.pem
chmod 600 rounds-key.pem
SG=$(aws ec2 create-security-group --group-name rounds-sg --description "Rounds app" --vpc-id "$VPC" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
  'IpProtocol=tcp,FromPort=3000,ToPort=3000,IpRanges=[{CidrIp=0.0.0.0/0}]' \
  'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0}]'

sleep 10 # instance profile propagation
IID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.large --key-name rounds-key \
  --security-group-ids "$SG" --subnet-id "$SUBNET" --iam-instance-profile Name=rounds-app-profile \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=40,VolumeType=gp3}' \
  --user-data file://userdata.sh --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=rounds-app}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$IID"
ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$IID" --allocation-id "$ALLOC"
aws ec2 describe-instances --instance-ids "$IID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text

# Put the DNS name printed above into cloudfront.json (Origins.Items[0].DomainName), then:
# aws cloudfront create-distribution --distribution-config file://cloudfront.json
